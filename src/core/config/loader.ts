import { existsSync, readFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { CorpConfig, CorpConfigSchema } from "./types.js";

const ENTERPRISES_DIR = "enterprises";
const CONFIG_ENV = "SEAL_HOME_ENTERPRISES_DIR";
const USER_DIR_ENV = "SEAL_HOME_USER_ENTERPRISES_DIR";
export const USER_ENTERPRISES_DIR = join(homedir(), ".config", "seal-home", "enterprises");

export function loadCorpConfigs(): CorpConfig[] {
  const dirs = resolveEnterprisesDirs();
  const byId = new Map<string, CorpConfig>();

  for (const dir of dirs) {
    for (const file of readdirSync(dir)
      .filter((item) => item.endsWith(".json"))
      .filter((item) => !item.startsWith("example."))) {
      const content = readFileSync(join(dir, file), "utf-8");
      const corp = CorpConfigSchema.parse(JSON.parse(content));
      byId.set(corp.id, corp);
    }
  }

  return Array.from(byId.values());
}

export function resolveEnterprisesDir(): string | undefined {
  return resolveEnterprisesDirs()[0];
}

export function resolveEnterprisesDirs(): string[] {
  const configured = process.env[CONFIG_ENV]?.trim();
  if (configured) return existsSync(configured) ? [configured] : [];

  const userDir = process.env[USER_DIR_ENV]?.trim() || USER_ENTERPRISES_DIR;
  return [ENTERPRISES_DIR, userDir].filter((dir) => existsSync(dir));
}

export function resolvePrimaryEnterprisesDir(): string | undefined {
  const configured = process.env[CONFIG_ENV]?.trim();
  if (configured) return existsSync(configured) ? configured : undefined;
  if (existsSync(ENTERPRISES_DIR)) return ENTERPRISES_DIR;
  const userDir = process.env[USER_DIR_ENV]?.trim() || USER_ENTERPRISES_DIR;
  return existsSync(userDir) ? userDir : undefined;
}

export function resolveWritableEnterprisesDir(): string {
  return process.env[CONFIG_ENV]?.trim() || USER_ENTERPRISES_DIR;
}

export function getEnterprisesDirCandidates(): string[] {
  return [
    `${CONFIG_ENV}=<path>`,
    ENTERPRISES_DIR,
    USER_ENTERPRISES_DIR
  ];
}
