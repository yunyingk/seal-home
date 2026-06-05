import { describe, expect, test } from "bun:test";
import { CorpConfigSchema } from "./types.js";

describe("CorpConfigSchema", () => {
  test("accepts Hose key/password aliases", () => {
    const config = CorpConfigSchema.parse({
      id: "corp-local",
      name: "Local Corp",
      source: {
        type: "hose",
        domain: "https://app.ekuaibao.com",
        key: "app-key",
        password: "app-security",
        corpId: "ID01",
        staffId: "ID01:STAFF01"
      }
    });

    expect(config.source.type).toBe("hose");
    if (config.source.type !== "hose") {
      throw new Error("expected hose source");
    }
    expect(config.source.key).toBe("app-key");
    expect(config.source.password).toBe("app-security");
    expect(config.auth.refreshTtl).toBe(300);
  });

  test("requires a Hose key and secret", () => {
    const result = CorpConfigSchema.safeParse({
      id: "corp-local",
      name: "Local Corp",
      source: {
        type: "hose",
        domain: "https://app.ekuaibao.com",
        corpId: "ID01",
        staffId: "ID01:STAFF01"
      }
    });

    expect(result.success).toBe(false);
  });

  test("accepts direct Seal bearer source", () => {
    const config = CorpConfigSchema.parse({
      id: "direct",
      name: "Direct",
      source: {
        type: "direct",
        token: "seal-token",
        sealUrl: "https://direct.sealai.cc"
      }
    });

    expect(config.source.type).toBe("direct");
    if (config.source.type !== "direct") {
      throw new Error("expected direct source");
    }
    expect(config.source.expiresIn).toBe(3600);
  });
});
