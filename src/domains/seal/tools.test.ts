import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { sealTools } from "./tools.js";

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
    expect(sealTools.find((item) => item.name === "seal_simulation_batch_records_get")).toBeDefined();
    expect(sealTools.find((item) => item.name === "seal_approval_run_langfuse_bridge_get")).toBeDefined();
  });
});
