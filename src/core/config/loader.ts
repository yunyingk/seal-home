import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { CorpConfig, CorpConfigSchema } from "./types.js";

const ENTERPRISES_DIR = "enterprises";

export function loadCorpConfigs(): CorpConfig[] {
  if (!existsSync(ENTERPRISES_DIR)) {
    return [];
  }

  return readdirSync(ENTERPRISES_DIR)
    .filter((file) => file.endsWith(".json"))
    .filter((file) => !file.startsWith("example."))
    .map((file) => {
      const content = readFileSync(join(ENTERPRISES_DIR, file), "utf-8");
      return CorpConfigSchema.parse(JSON.parse(content));
    });
}
