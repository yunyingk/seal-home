#!/usr/bin/env bun

import { loadCorpConfigs } from "./core/config/loader.js";
import { createSealClient } from "./core/http/factory.js";
import { resolveLiveSealEnterpriseConfig } from "./domains/seal/source.js";
import { sealTools, type SealTool } from "./domains/seal/tools.js";
import { CorpConfig } from "./core/config/types.js";

type ParsedArgs = {
  command: string[];
  options: Record<string, string | boolean>;
  json?: unknown;
};

async function main() {
  const args = parseArgs(Bun.argv.slice(2));
  const [area, action, maybeName] = args.command;

  if (!area || area === "help" || args.options.help) {
    printHelp();
    return;
  }

  if (area === "tools" && action === "list") {
    printJson(sealTools.map((tool) => ({ name: tool.name, description: tool.description })));
    return;
  }

  if (area === "corps" && action === "list") {
    const corpId = stringOption(args.options.corp);
    const corps = loadCorpConfigs();
    const currentCorpId = corpId ?? corps[0]?.id;
    printJson(corps.map((item) => ({
      id: item.id,
      name: item.name,
      sourceType: item.source.type,
      current: item.id === currentCorpId
    })));
    return;
  }

  const corp = selectCorp(String(args.options.corp ?? ""));

  if (area === "source" && action === "config") {
    printJson(await resolveLiveSealEnterpriseConfig(corp));
    return;
  }

  const client = await createSealClient(corp);

  if (area === "tool") {
    if (!action) throw new Error("Usage: seal-home tool <toolName> [--json '{...}']");
    await runTool(action, client, corp, jsonObject(args.json));
    return;
  }

  if (area === "approval-runs" && action === "summary") {
    await runTool("seal_approval_runs_summary", client, corp, {
      date: stringOption(args.options.date),
      timezone: stringOption(args.options.timezone),
      limit: numberOption(args.options.limit),
      status: stringOption(args.options.status),
      taskMode: stringOption(args.options.taskMode),
      sourceDocumentSN: stringOption(args.options.sourceDocumentSN),
      sourceDocumentId: stringOption(args.options.sourceDocumentId),
      query: stringOption(args.options.query)
    });
    return;
  }

  if (area === "approval-runs" && action === "search") {
    await runTool("seal_approval_runs_search", client, corp, {
      limit: numberOption(args.options.limit),
      offset: numberOption(args.options.offset),
      status: stringOption(args.options.status),
      taskMode: stringOption(args.options.taskMode),
      sourceDocumentSN: stringOption(args.options.sourceDocumentSN),
      sourceDocumentId: stringOption(args.options.sourceDocumentId),
      query: stringOption(args.options.query),
      includeBridge: booleanOption(args.options.includeBridge)
    });
    return;
  }

  if (area === "approval-runs" && action === "bridge") {
    await runTool("seal_approval_run_langfuse_bridge_get", client, corp, {
      recordId: stringOption(args.options.recordId),
      sourceDocumentSN: stringOption(args.options.sourceDocumentSN),
      sourceDocumentId: stringOption(args.options.sourceDocumentId),
      simulationBatchId: stringOption(args.options.simulationBatchId),
      limit: numberOption(args.options.limit)
    });
    return;
  }

  if (area === "simulation" && action === "batch-records") {
    const batchId = maybeName ?? stringOption(args.options.batchId);
    if (!batchId) throw new Error("Usage: seal-home simulation batch-records <batchId>");
    await runTool("seal_simulation_batch_records_get", client, corp, {
      batchId,
      query: stringOption(args.options.query)
    });
    return;
  }

  throw new Error(`Unknown command: ${args.command.join(" ")}`);
}

async function runTool(
  name: string,
  client: Awaited<ReturnType<typeof createSealClient>>,
  corp: CorpConfig,
  params: Record<string, unknown>
) {
  const tool = sealTools.find((item) => item.name === name);
  if (!tool) throw new Error(`Unknown Seal tool: ${name}`);

  const compactParams = Object.fromEntries(
    Object.entries(params).filter(([, value]) => value !== undefined)
  );
  const handler = tool.handler as SealTool["handler"];
  const result = await handler(client, compactParams as never, { corp });
  printJson(result);
}

function selectCorp(corpId: string): CorpConfig {
  const corps = loadCorpConfigs();
  const corp = corpId
    ? corps.find((item) => item.id === corpId)
    : corps[0];

  if (!corp) {
    throw new Error(
      corpId
        ? `No enterprise config found for ${corpId}`
        : "No enterprise config found. Add a non-example JSON file under enterprises/."
    );
  }

  return corp;
}

function parseArgs(argv: string[]): ParsedArgs {
  const command: string[] = [];
  const options: Record<string, string | boolean> = {};
  let json: unknown;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg) continue;

    if (arg === "--json") {
      const raw = argv[index + 1];
      if (!raw) throw new Error("--json requires a JSON object argument");
      json = JSON.parse(raw);
      index += 1;
      continue;
    }

    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = argv[index + 1];
      if (!next || next.startsWith("--")) {
        options[key] = true;
      } else {
        options[key] = next;
        index += 1;
      }
      continue;
    }

    command.push(arg);
  }

  return { command, options, json };
}

function jsonObject(value: unknown): Record<string, unknown> {
  if (value === undefined) return {};
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("--json must be an object");
  }
  return value as Record<string, unknown>;
}

function stringOption(value: string | boolean | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function numberOption(value: string | boolean | undefined): number | undefined {
  if (typeof value !== "string") return undefined;
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`Invalid number: ${value}`);
  return number;
}

function booleanOption(value: string | boolean | undefined): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value === "boolean") return value;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error(`Invalid boolean: ${value}`);
}

function printJson(value: unknown) {
  console.log(JSON.stringify(value, null, 2));
}

function printHelp() {
  console.log(`seal-home CLI

Usage:
  seal-home tools list
  seal-home corps list [--corp <corpId>]
  seal-home source config [--corp <corpId>]
  seal-home tool <toolName> [--corp <corpId>] [--json '{"key":"value"}']
  seal-home approval-runs summary [--date YYYY-MM-DD] [--timezone Asia/Shanghai]
  seal-home approval-runs search [--query text] [--limit 20] [--includeBridge true]
  seal-home approval-runs bridge [--sourceDocumentSN B26001887]
  seal-home simulation batch-records <batchId>
`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
