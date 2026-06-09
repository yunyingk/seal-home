import { describe, expect, test } from "bun:test";
import { KyInstance } from "ky";
import { z } from "zod";
import { findSealMcpTool, findSealTool, sealMcpTools, sealTools } from "./tools.js";

type ToolHandler = (
  client: KyInstance,
  params: Record<string, unknown>,
  context: ReturnType<typeof fakeContext>
) => Promise<unknown>;

describe("sealTools", () => {
  test("exposes concrete JSON schemas for parameterized tools", () => {
    const createRule = sealTools.find((tool) => tool.name === "seal_approval_rule_create");
    expect(createRule).toBeDefined();

    const schema = z.toJSONSchema(createRule!.parameters) as {
      properties?: Record<string, unknown>;
      required?: string[];
    };

    expect(Object.keys(schema.properties ?? {})).toEqual([
      "description",
      "scope",
      "strictness"
    ]);
    expect(schema.required).toEqual(["description", "scope", "strictness"]);
  });

  test("includes the approval context aggregation tool", () => {
    const tool = sealTools.find((item) => item.name === "seal_approval_context_get");
    expect(tool).toBeDefined();
  });

  test("includes the session diagnostic tool", () => {
    const tool = sealTools.find((item) => item.name === "seal_session_get");
    expect(tool).toBeDefined();
  });

  test("includes the approval search tool", () => {
    const tool = sealTools.find((item) => item.name === "seal_approval_search");
    expect(tool).toBeDefined();
  });

  test("includes approval run Langfuse bridge tools", () => {
    expect(sealTools.find((item) => item.name === "seal_approval_runs_search")).toBeDefined();
    expect(sealTools.find((item) => item.name === "seal_approval_runs_summary")).toBeDefined();
    expect(sealTools.find((item) => item.name === "seal_simulation_batch_records_get")).toBeDefined();
    expect(sealTools.find((item) => item.name === "seal_approval_run_langfuse_bridge_get")).toBeDefined();
  });

  test("keeps the MCP exposed tool surface narrow", () => {
    expect(sealMcpTools.map((tool) => tool.name)).toEqual([
      "seal_whoami",
      "seal_approval_search",
      "seal_approval_context_get",
      "seal_runs_search",
      "seal_action"
    ]);
  });

  test("routes low-frequency management tools through seal_action", async () => {
    const tool = sealMcpTools.find((item) => item.name === "seal_action");
    expect(tool).toBeDefined();

    const handler = tool!.handler as ToolHandler;
    const result = await handler(
      fakeApprovalRunsClient(),
      { action: "runs.summary", payload: { date: "2026-06-08", timezone: "Asia/Shanghai" } },
      fakeContext()
    ) as { matched: number };

    expect(result.matched).toBe(2);
  });

  test("keeps old fine-grained tools available to compatibility callers but hidden from MCP list", () => {
    expect(sealMcpTools.find((item) => item.name === "seal_approval_rule_create")).toBeUndefined();
    expect(findSealMcpTool("seal_approval_rule_create")).toBeUndefined();
    expect(findSealTool("seal_approval_rule_create")).toBeDefined();
    expect(findSealMcpTool("seal_action")).toBeDefined();
    expect(findSealMcpTool("seal_runs_search")?.name).toBe("seal_runs_search");
  });

  test("approval run search omits bridge unless requested", async () => {
    const tool = sealTools.find((item) => item.name === "seal_approval_runs_search");
    expect(tool).toBeDefined();

    const handler = tool!.handler as ToolHandler;
    const result = await handler(fakeApprovalRunsClient(), { limit: 1 }, fakeContext());

    expect(result).not.toHaveProperty("bridge");
    expect(result).toHaveProperty("records");
  });

  test("approval run summary filters by local date and returns compact aggregates", async () => {
    const tool = sealTools.find((item) => item.name === "seal_approval_runs_summary");
    expect(tool).toBeDefined();

    const handler = tool!.handler as ToolHandler;
    const result = await handler(
      fakeApprovalRunsClient(),
      { date: "2026-06-08", timezone: "Asia/Shanghai", limit: 100 },
      fakeContext()
    ) as {
      matched: number;
      statusCounts: Record<string, number>;
      taskModeCounts: Record<string, number>;
      records: Array<{ sourceDocumentSN?: string; createdAt?: string }>;
    };

    expect(result.matched).toBe(2);
    expect(result.statusCounts).toEqual({ completed: 1, failed: 1 });
    expect(result.taskModeCounts).toEqual({ assisted: 1, simulation: 1 });
    expect(result.records.map((record) => record.sourceDocumentSN)).toEqual([
      "B26001965",
      "B26001808"
    ]);
    expect(result.records[0]?.createdAt).toBe("2026-06-08 13:56:04");
  });
});

function fakeApprovalRunsClient(): KyInstance {
  return {
    get: () => ({
      json: async () => ({
        data: {
          total: 3,
          records: [
            {
              id: "run-1",
              status: "completed",
              taskMode: "assisted",
              sourceDocumentSN: "B26001965",
              sourceDocumentId: "doc-source-1",
              sourceExtendData: { _langfuseTraceId: "trace-1" },
              createdAt: 1780898164536
            },
            {
              id: "run-2",
              status: "failed",
              taskMode: "simulation",
              sourceDocumentSN: "B26001808",
              sourceDocumentId: "doc-source-2",
              createdAt: 1780887698055
            },
            {
              id: "run-3",
              status: "completed",
              taskMode: "assisted",
              sourceDocumentSN: "B26001762",
              sourceDocumentId: "doc-source-3",
              createdAt: 1780742324888
            }
          ]
        }
      })
    })
  } as unknown as KyInstance;
}

function fakeContext() {
  return {
    corp: {
      id: "corp-a",
      name: "Corp A",
      seal: {
        endpoints: {
          approvalStylePreferences: "api/v1/agent/ai-approval/config"
        }
      },
      source: {
        type: "direct",
        token: "token",
        sealUrl: "https://seal.test"
      },
      auth: {
        refreshTtl: 300
      }
    }
  };
}
