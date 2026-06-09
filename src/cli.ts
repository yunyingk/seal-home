#!/usr/bin/env bun

import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getEnterprisesDirCandidates, loadCorpConfigs } from "./core/config/loader.js";
import { createSealClient } from "./core/http/factory.js";
import { resolveLiveSealEnterpriseConfig } from "./domains/seal/source.js";
import { sealTools, type SealTool } from "./domains/seal/tools.js";
import { CorpConfig } from "./core/config/types.js";

const VERSION = "0.3.0";
const APP_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const STATE_DIR = join(homedir(), ".config", "seal-home");
const SERVICE_PID_FILE = join(STATE_DIR, "service.pid");
const SERVICE_LOG_FILE = join(STATE_DIR, "service.log");

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

  if (area === "version") {
    printJson({
      name: "seal-home",
      version: VERSION
    });
    return;
  }

  if (area === "config" && action === "paths") {
    printJson({
      candidates: getEnterprisesDirCandidates()
    });
    return;
  }

  if (area === "service") {
    await runServiceCommand(action);
    return;
  }

  if (area === "update") {
    updateAndRestart();
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
      startDate: stringOption(args.options.startDate),
      endDate: stringOption(args.options.endDate),
      status: stringOption(args.options.status),
      taskMode: stringOption(args.options.taskMode),
      manualApprovalStatus: stringOption(args.options.manualApprovalStatus),
      sourceDocumentSN: stringOption(args.options.sourceDocumentSN),
      sourceDocumentId: stringOption(args.options.sourceDocumentId),
      humanResult: stringOption(args.options.humanResult),
      query: stringOption(args.options.query)
    });
    return;
  }

  if (area === "approval-runs" && action === "search") {
    await runTool("seal_approval_runs_search", client, corp, {
      limit: numberOption(args.options.limit),
      offset: numberOption(args.options.offset),
      startDate: stringOption(args.options.startDate),
      endDate: stringOption(args.options.endDate),
      status: stringOption(args.options.status),
      taskMode: stringOption(args.options.taskMode),
      manualApprovalStatus: stringOption(args.options.manualApprovalStatus),
      sourceDocumentSN: stringOption(args.options.sourceDocumentSN),
      sourceDocumentId: stringOption(args.options.sourceDocumentId),
      humanResult: stringOption(args.options.humanResult),
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

  if (area === "approval-runs" && action === "get") {
    const recordId = args.command[2];
    if (!recordId) throw new Error("Missing approval run recordId");
    await runTool("seal_approval_run_get", client, corp, { recordId });
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

async function runServiceCommand(action?: string) {
  switch (action) {
    case "run":
      await runService();
      return;
    case "start":
      startService();
      return;
    case "stop":
      stopService();
      return;
    case "restart":
      stopService({ quiet: true });
      startService();
      return;
    case "status":
    case undefined:
      printJson(serviceStatus());
      return;
    default:
      throw new Error("Usage: seal-home service <start|stop|restart|status>");
  }
}

async function runService() {
  ensureStateDir();
  writeFileSync(SERVICE_PID_FILE, `${process.pid}\n`);
  appendLog(`running pid=${process.pid}`);

  const cleanup = () => {
    if (readServicePid() === process.pid) {
      rmSync(SERVICE_PID_FILE, { force: true });
    }
    appendLog(`stopped pid=${process.pid}`);
  };

  process.on("SIGTERM", () => {
    cleanup();
    process.exit(0);
  });
  process.on("SIGINT", () => {
    cleanup();
    process.exit(0);
  });

  setInterval(() => {
    // Keep the process alive for warmed auth/search caches in this runtime.
  }, 60_000);

  await new Promise(() => {});
}

function startService() {
  ensureStateDir();
  const current = serviceStatus();
  if (current.running) {
    printJson(current);
    return;
  }

  const child = spawn(process.execPath, [fileURLToPath(import.meta.url), "service", "run"], {
    cwd: APP_ROOT,
    detached: true,
    stdio: ["ignore", "ignore", "ignore"],
    env: process.env
  });
  child.unref();

  writeFileSync(SERVICE_PID_FILE, `${child.pid}\n`);
  appendLog(`started pid=${child.pid}`);
  printJson({
    started: true,
    ...serviceStatus()
  });
}

function stopService(options: { quiet?: boolean } = {}) {
  const pid = readServicePid();
  if (!pid) {
    if (!options.quiet) printJson({ stopped: false, reason: "not running" });
    return;
  }

  if (isProcessRunning(pid)) {
    process.kill(pid, "SIGTERM");
  }
  rmSync(SERVICE_PID_FILE, { force: true });
  appendLog(`stop requested pid=${pid}`);

  if (!options.quiet) {
    printJson({ stopped: true, pid });
  }
}

function serviceStatus() {
  const pid = readServicePid();
  return {
    running: pid ? isProcessRunning(pid) : false,
    pid,
    version: VERSION,
    appRoot: APP_ROOT,
    stateDir: STATE_DIR,
    pidFile: SERVICE_PID_FILE,
    logFile: SERVICE_LOG_FILE
  };
}

function updateAndRestart() {
  const wasRunning = serviceStatus().running;
  if (wasRunning) stopService({ quiet: true });

  runCommand("git", ["-C", APP_ROOT, "pull", "--ff-only"]);
  runCommand("bun", ["install"], { cwd: APP_ROOT });

  if (wasRunning) startService();

  printJson({
    updated: true,
    serviceRestarted: wasRunning,
    version: VERSION
  });
}

function runCommand(command: string, args: string[], options: { cwd?: string } = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    stdio: "inherit"
  });

  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed with status ${result.status}`);
  }
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
        : `No enterprise config found. Add a non-example JSON file under one of: ${getEnterprisesDirCandidates().join(", ")}`
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

function ensureStateDir() {
  mkdirSync(STATE_DIR, { recursive: true });
}

function readServicePid(): number | undefined {
  if (!existsSync(SERVICE_PID_FILE)) return undefined;
  const pid = Number(readFileSync(SERVICE_PID_FILE, "utf-8").trim());
  return Number.isInteger(pid) && pid > 0 ? pid : undefined;
}

function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function appendLog(message: string) {
  ensureStateDir();
  writeFileSync(SERVICE_LOG_FILE, `${new Date().toISOString()} ${message}\n`, { flag: "a" });
}

function printJson(value: unknown) {
  console.log(JSON.stringify(value, null, 2));
}

function printHelp() {
  console.log(`seal-home CLI

Usage:
  seal-home version
  seal-home config paths
  seal-home service <start|stop|restart|status>
  seal-home update
  seal-home tools list
  seal-home corps list [--corp <corpId>]
  seal-home source config [--corp <corpId>]
  seal-home tool <toolName> [--corp <corpId>] [--json '{"key":"value"}']
  seal-home approval-runs summary [--date YYYY-MM-DD] [--timezone Asia/Shanghai]
  seal-home approval-runs search [--query text] [--humanResult 驳回] [--manualApprovalStatus TERMINATED] [--startDate ms] [--endDate ms] [--limit 20] [--includeBridge true]
  seal-home approval-runs get <recordId>
  seal-home approval-runs bridge [--sourceDocumentSN B26001887]
  seal-home simulation batch-records <batchId>
`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
