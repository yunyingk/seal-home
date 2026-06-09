import { existsSync, readFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { CorpConfig, CorpConfigSchema } from "./types.js";

const ENTERPRISES_DIR = "enterprises";
const CONFIG_ENV = "SEAL_HOME_ENTERPRISES_DIR";

export function loadCorpConfigs(): CorpConfig[] {
  const dir = resolveEnterprisesDir();
  if (!dir) {
    return [];
  }

  return readdirSync(dir)
    .filter((file) => file.endsWith(".json"))
    .filter((file) => !file.startsWith("example."))
    .map((file) => {
      const content = readFileSync(join(dir, file), "utf-8");
      return CorpConfigSchema.parse(JSON.parse(content));
    });
}

export function resolveEnterprisesDir(): string | undefined {
  const configured = process.env[CONFIG_ENV]?.trim();
  if (configured) return existsSync(configured) ? configured : undefined;

  if (existsSync(ENTERPRISES_DIR)) return ENTERPRISES_DIR;

  const userConfigDir = join(homedir(), ".config", "seal-home", "enterprises");
  return existsSync(userConfigDir) ? userConfigDir : undefined;
}

export function getEnterprisesDirCandidates(): string[] {
  return [
    `${CONFIG_ENV}=<path>`,
    ENTERPRISES_DIR,
    join(homedir(), ".config", "seal-home", "enterprises")
  ];
}
