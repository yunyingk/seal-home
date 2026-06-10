import ky, { HTTPError, KyInstance } from "ky";
import { CorpConfig, HoseSealSource } from "../config/types.js";
import { getHoseAuthCache, setHoseAuthCache } from "./token-store.js";
import { SealEnterpriseConfig, SealSession, TokenEntry } from "./types.js";

type HoseLoginResponse = {
  value?: {
    accessToken?: string;
    refreshToken?: string;
    corporation?: {
      id?: string;
      name?: string;
    };
    staff?: {
      id?: string;
      name?: string;
    };
  };
  accessToken?: string;
  token?: string;
  data?: unknown;
};

type HoseProvisionalResponse = {
  value?: {
    message?: string;
  };
};

type SealTokenResponse = {
  token?: string;
  accessToken?: string;
  expiresIn?: number;
  expires_in?: number;
  data?: {
    token?: string;
    accessToken?: string;
    expiresIn?: number;
    expires_in?: number;
  };
};

function normalizeBaseUrl(url: string): string {
  return url.replace(/\/+$/, "");
}

function isFresh(entry: TokenEntry | undefined, refreshTtl = 60): entry is TokenEntry {
  return Boolean(entry && Date.now() < entry.expiresAt - refreshTtl * 1000);
}

function defaultSealUrl(corp: CorpConfig, source: HoseSealSource): string {
  if (corp.seal.url) return corp.seal.url;
  if (source.sealUrl) return source.sealUrl;
  return `https://${source.corpId.toLowerCase()}.sealai.cc`;
}

function hoseUid(source: HoseSealSource): string {
  return source.staffId.includes(":")
    ? source.staffId
    : `${source.corpId}:${source.staffId}`;
}

function hoseClient(source: HoseSealSource): KyInstance {
  return ky.create({
    prefix: normalizeBaseUrl(source.domain),
    timeout: 30000,
    hooks: {
      beforeError: [
        async ({ error }) => {
          const body =
            error instanceof HTTPError
              ? await error.response.text().catch(() => "")
              : "";
          error.message = `${error.message}${body ? `: ${body}` : ""}`;
          return error;
        }
      ]
    }
  });
}

async function fetchHoseOpenapiToken(source: HoseSealSource): Promise<TokenEntry> {
  const client = hoseClient(source);
  const appKey = source.appKey ?? source.key;
  const appSecurity = source.appSecurity ?? source.password;

  if (!appKey || !appSecurity) {
    throw new Error("Hose source requires appKey/key and appSecurity/password");
  }

  const response = await client
    .post("api/openapi/v1/auth/getAccessToken", {
      json: {
        appKey,
        appSecurity
      }
    })
    .json<HoseLoginResponse>();

  const token = response.value?.accessToken ?? response.accessToken ?? response.token;
  if (!token) {
    throw new Error("Hose login did not return an access token");
  }

  return {
    token,
    expiresAt: Date.now() + 3600 * 1000
  };
}

async function ensureHoseOpenapiToken(corp: CorpConfig): Promise<string> {
  if (corp.source.type !== "hose") {
    throw new Error(`Unsupported Seal source: ${corp.source.type}`);
  }

  const cache = getHoseAuthCache(corp.id);
  if (isFresh(cache.openapi)) {
    return cache.openapi.token;
  }

  const openapi = await fetchHoseOpenapiToken(corp.source);
  setHoseAuthCache(corp.id, {
    ...cache,
    openapi
  });
  return openapi.token;
}

async function fetchHoseCloseApiToken(
  source: HoseSealSource,
  openapiToken: string,
  expiresIn = 7200
): Promise<TokenEntry> {
  const client = hoseClient(source);
  const uid = hoseUid(source);

  const response = await client
    .post("api/openapi/v1.1/provisional/getProvisionalAuth", {
      searchParams: {
        accessToken: openapiToken
      },
      json: {
        uid,
        pageType: "home",
        expireDate: expiresIn
      }
    })
    .json<HoseProvisionalResponse>();

  const url = response.value?.message;
  if (!url) {
    throw new Error("Hose CloseAPI did not return a provisional auth URL");
  }

  const closeapiToken = new URL(url).searchParams.get("accessToken");
  if (!closeapiToken) {
    throw new Error("Hose provisional auth URL did not include accessToken");
  }

  return {
    token: closeapiToken,
    url,
    expiresAt: Date.now() + expiresIn * 1000
  };
}

async function ensureHoseCloseApiToken(corp: CorpConfig): Promise<TokenEntry> {
  if (corp.source.type !== "hose") {
    throw new Error(`Unsupported Seal source: ${corp.source.type}`);
  }

  const cache = getHoseAuthCache(corp.id);
  if (isFresh(cache.closeapi) && cache.closeapi.url) {
    return cache.closeapi;
  }

  const openapiToken = await ensureHoseOpenapiToken(corp);
  const closeapi = await fetchHoseCloseApiToken(corp.source, openapiToken);
  setHoseAuthCache(corp.id, {
    ...getHoseAuthCache(corp.id),
    closeapi
  });
  return closeapi;
}

export async function getHoseEnterpriseUrl(corp: CorpConfig): Promise<string> {
  if (corp.source.type !== "hose") {
    throw new Error(`Unsupported Seal source: ${corp.source.type}`);
  }

  const url = (await ensureHoseCloseApiToken(corp)).url;
  if (!url) {
    throw new Error("Hose provisional auth URL was not available");
  }
  return url;
}

export async function getHoseProvisionalAuthLink(
  corp: CorpConfig,
  expiresIn = 7200
): Promise<{
  corpId: string;
  staffId: string;
  url: string;
  expiresIn: number;
}> {
  if (corp.source.type !== "hose") {
    throw new Error(`Unsupported Seal source: ${corp.source.type}`);
  }

  const openapiToken = await ensureHoseOpenapiToken(corp);
  const provisional = await fetchHoseCloseApiToken(corp.source, openapiToken, expiresIn);
  if (!provisional.url) {
    throw new Error("Hose provisional auth URL was not available");
  }

  return {
    corpId: corp.source.corpId,
    staffId: corp.source.staffId,
    url: provisional.url,
    expiresIn
  };
}

export async function getHoseSealSession(corp: CorpConfig): Promise<SealSession> {
  if (corp.source.type !== "hose") {
    throw new Error(`Unsupported Seal source: ${corp.source.type}`);
  }

  const hoseAccess = await ensureHoseCloseApiToken(corp);
  const sealUrl = defaultSealUrl(corp, corp.source);

  const sealResponse = await ky
    .get(`${normalizeBaseUrl(sealUrl)}/api/auth/oauth2/session/oem-hosecloud`, {
      searchParams: {
        token: hoseAccess.token,
        returnToken: "1"
      },
      timeout: 30000
    })
    .json<SealTokenResponse>();

  const token =
    sealResponse.token ??
    sealResponse.accessToken ??
    sealResponse.data?.token ??
    sealResponse.data?.accessToken;
  if (!token) {
    throw new Error("Seal SSO did not return a bearer token");
  }

  const expiresIn =
    sealResponse.expiresIn ??
    sealResponse.expires_in ??
    sealResponse.data?.expiresIn ??
    sealResponse.data?.expires_in ??
    3600;

  const enterprise: SealEnterpriseConfig = {
    provider: "hose",
    corpId: corp.source.corpId,
    staffId: corp.source.staffId,
    sealUrl: normalizeBaseUrl(sealUrl),
    tenantSlug: corp.seal.tenantSlug,
    raw: {
      sourceType: "hose",
      hoseDomain: normalizeBaseUrl(corp.source.domain)
    }
  };

  return {
    token,
    expiresAt: Date.now() + expiresIn * 1000,
    enterprise
  };
}
