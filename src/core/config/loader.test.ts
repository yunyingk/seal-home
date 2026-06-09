import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadCorpConfigs, resolveEnterprisesDir } from "./loader.js";

const ORIGINAL_ENV = process.env.SEAL_HOME_ENTERPRISES_DIR;
const tempDirs: string[] = [];

afterEach(() => {
  if (ORIGINAL_ENV === undefined) {
    delete process.env.SEAL_HOME_ENTERPRISES_DIR;
  } else {
    process.env.SEAL_HOME_ENTERPRISES_DIR = ORIGINAL_ENV;
  }

  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("loadCorpConfigs", () => {
  test("loads configs from SEAL_HOME_ENTERPRISES_DIR", () => {
    const dir = makeTempDir();
    writeFileSync(join(dir, "example.hose.json"), "{}");
    writeFileSync(join(dir, "local.json"), JSON.stringify({
      id: "direct",
      name: "Direct",
      source: {
        type: "direct",
        token: "seal-token",
        sealUrl: "https://direct.sealai.cc"
      }
    }));
    process.env.SEAL_HOME_ENTERPRISES_DIR = dir;

    expect(resolveEnterprisesDir()).toBe(dir);
    expect(loadCorpConfigs().map((corp) => corp.id)).toEqual(["direct"]);
  });

  test("returns no configs when explicit env directory does not exist", () => {
    process.env.SEAL_HOME_ENTERPRISES_DIR = join(makeTempDir(), "missing");

    expect(resolveEnterprisesDir()).toBeUndefined();
    expect(loadCorpConfigs()).toEqual([]);
  });
});

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "seal-home-loader-"));
  mkdirSync(dir, { recursive: true });
  tempDirs.push(dir);
  return dir;
}
