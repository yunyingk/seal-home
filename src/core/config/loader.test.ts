import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadCorpConfigs, resolveEnterprisesDir } from "./loader.js";

const ORIGINAL_ENV = process.env.SEAL_HOME_ENTERPRISES_DIR;
const ORIGINAL_USER_DIR_ENV = process.env.SEAL_HOME_USER_ENTERPRISES_DIR;
const ORIGINAL_CWD = process.cwd();
const tempDirs: string[] = [];

afterEach(() => {
  process.chdir(ORIGINAL_CWD);
  if (ORIGINAL_ENV === undefined) {
    delete process.env.SEAL_HOME_ENTERPRISES_DIR;
  } else {
    process.env.SEAL_HOME_ENTERPRISES_DIR = ORIGINAL_ENV;
  }
  if (ORIGINAL_USER_DIR_ENV === undefined) {
    delete process.env.SEAL_HOME_USER_ENTERPRISES_DIR;
  } else {
    process.env.SEAL_HOME_USER_ENTERPRISES_DIR = ORIGINAL_USER_DIR_ENV;
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

  test("merges local and user enterprise directories with user configs taking precedence", () => {
    const workspace = makeTempDir();
    const workspaceEnterprises = join(workspace, "enterprises");
    const userDir = makeTempDir();
    mkdirSync(workspaceEnterprises, { recursive: true });
    writeCorpConfig(join(workspaceEnterprises, "shared.json"), "shared", "Workspace");
    writeCorpConfig(join(userDir, "shared.json"), "shared", "User");
    writeCorpConfig(join(userDir, "user-only.json"), "user-only", "User Only");
    process.chdir(workspace);
    process.env.SEAL_HOME_USER_ENTERPRISES_DIR = userDir;

    expect(loadCorpConfigs().map((corp) => [corp.id, corp.name])).toEqual([
      ["shared", "User"],
      ["user-only", "User Only"]
    ]);
  });
});

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "seal-home-loader-"));
  mkdirSync(dir, { recursive: true });
  tempDirs.push(dir);
  return dir;
}

function writeCorpConfig(path: string, id: string, name: string) {
  writeFileSync(path, JSON.stringify({
    id,
    name,
    source: {
      type: "direct",
      token: "seal-token",
      sealUrl: `https://${id}.sealai.cc`
    }
  }));
}
