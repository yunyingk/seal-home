import { describe, expect, test } from "bun:test";
import { CorpConfig } from "./types.js";
import { CorpContext } from "./manager.js";

function corp(id: string, name = id): CorpConfig {
  return {
    id,
    name,
    seal: {
      endpoints: {
        approvalStylePreferences: "api/v1/agent/ai-approval/config"
      }
    },
    source: {
      type: "direct",
      token: `${id}-token`,
      sealUrl: `https://${id}.seal.test`,
      expiresIn: 3600,
      staffId: "direct"
    },
    auth: {
      refreshTtl: 300
    }
  };
}

describe("CorpContext", () => {
  test("refresh adds newly loaded corps", () => {
    const context = new CorpContext([corp("corp-a")]);

    context.refresh([corp("corp-a"), corp("corp-b")]);

    expect(context.listCorps().map((item) => item.id)).toEqual(["corp-a", "corp-b"]);
  });

  test("refresh keeps the selected corp when it still exists", () => {
    const context = new CorpContext([corp("corp-a"), corp("corp-b")]);
    expect(context.switchCorp("corp-b")).toBe(true);

    context.refresh([corp("corp-a"), corp("corp-b", "Corp B updated")]);

    expect(context.getCurrent()?.id).toBe("corp-b");
    expect(context.getCurrent()?.name).toBe("Corp B updated");
  });

  test("refresh falls back when the selected corp disappears", () => {
    const context = new CorpContext([corp("corp-a"), corp("corp-b")]);
    expect(context.switchCorp("corp-b")).toBe(true);

    context.refresh([corp("corp-c")]);

    expect(context.getCurrent()?.id).toBe("corp-c");
  });
});
