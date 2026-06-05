import { CorpConfig } from "../config/types.js";
import { SealSession } from "./types.js";

export async function getDirectSealSession(corp: CorpConfig): Promise<SealSession> {
  if (corp.source.type !== "direct") {
    throw new Error(`Unsupported Seal source: ${corp.source.type}`);
  }

  const sealUrl = corp.seal.url ?? corp.source.sealUrl;

  return {
    token: corp.source.token,
    expiresAt: Date.now() + corp.source.expiresIn * 1000,
    enterprise: {
      provider: "direct",
      corpId: corp.source.corpId ?? corp.id,
      staffId: corp.source.staffId,
      sealUrl,
      tenantSlug: corp.seal.tenantSlug,
      raw: {
        sourceType: "direct"
      }
    }
  };
}
