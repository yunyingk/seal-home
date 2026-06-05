import { CorpConfig } from "../config/types.js";
import { getDirectSealSession } from "./direct.js";
import { getHoseSealSession } from "./hose.js";
import { clearSealSession, getSealSession, setSealSession } from "./token-store.js";
import { SealEnterpriseConfig, SealSession } from "./types.js";

const memoryCache = new Map<string, SealSession>();

function isExpired(session: SealSession, refreshTtl: number): boolean {
  return Date.now() >= session.expiresAt - refreshTtl * 1000;
}

async function refreshSealSession(corp: CorpConfig): Promise<SealSession> {
  switch (corp.source.type) {
    case "hose":
      return getHoseSealSession(corp);
    case "direct":
      return getDirectSealSession(corp);
  }
}

export async function getSealSessionForCorp(corp: CorpConfig): Promise<SealSession> {
  const refreshTtl = corp.auth.refreshTtl;
  const cached = memoryCache.get(corp.id);
  if (cached && !isExpired(cached, refreshTtl)) {
    return cached;
  }

  const stored = getSealSession(corp.id);
  if (stored && !isExpired(stored, refreshTtl)) {
    memoryCache.set(corp.id, stored);
    return stored;
  }

  const next = await refreshSealSession(corp);
  memoryCache.set(corp.id, next);
  setSealSession(corp.id, next);
  return next;
}

export async function getSealToken(corp: CorpConfig): Promise<string> {
  return (await getSealSessionForCorp(corp)).token;
}

export async function resolveSealEnterpriseConfig(
  corp: CorpConfig
): Promise<SealEnterpriseConfig> {
  return (await getSealSessionForCorp(corp)).enterprise;
}

export function clearSealToken(corpId: string): void {
  memoryCache.delete(corpId);
  clearSealSession(corpId);
}
