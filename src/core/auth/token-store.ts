import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import {
  CorpTokenCache,
  HoseAuthCache,
  SealSession,
  TokenStore,
  TokenStoreSchema
} from "./types.js";

function storePath(): string {
  return process.env.SEAL_HOME_TOKEN_STORE
    ?? join(homedir(), ".config", "seal-home", "seal_tokens.json");
}

function readStore(): TokenStore {
  const path = storePath();
  if (!existsSync(path)) {
    return {};
  }

  try {
    return TokenStoreSchema.parse(JSON.parse(readFileSync(path, "utf-8")));
  } catch {
    return {};
  }
}

function writeStore(store: TokenStore): void {
  const path = storePath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(store, null, 2));
}

export function getSealSession(corpId: string): SealSession | undefined {
  return readStore()[corpId]?.seal;
}

export function setSealSession(corpId: string, session: SealSession): void {
  const store = readStore();
  writeStore({
    ...store,
    [corpId]: {
      ...store[corpId],
      seal: session
    }
  });
}

export function clearSealSession(corpId: string): void {
  const store = readStore();
  const current = store[corpId];
  if (!current) return;

  writeStore({
    ...store,
    [corpId]: {
      ...current,
      seal: undefined
    }
  });
}

export function getCorpTokenCache(corpId: string): CorpTokenCache {
  return readStore()[corpId] ?? {};
}

export function getHoseAuthCache(corpId: string): HoseAuthCache {
  return readStore()[corpId]?.hose ?? {};
}

export function setHoseAuthCache(corpId: string, hose: HoseAuthCache): void {
  const store = readStore();
  writeStore({
    ...store,
    [corpId]: {
      ...store[corpId],
      hose
    }
  });
}

export function clearCorpTokenCache(corpId: string): void {
  const store = readStore();
  delete store[corpId];
  writeStore(store);
}
