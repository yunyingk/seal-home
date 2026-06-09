#!/usr/bin/env bun

import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getEnterprisesDirCandidates, loadCorpConfigs, resolveWritableEnterprisesDir } from "./core/config/loader.js";
import { createSealClient } from "./core/http/factory.js";
import { resolveLiveSealEnterpriseConfig } from "./domains/seal/source.js";
import { getMe } from "./domains/seal/api.js";
import { sealTools, type SealTool } from "./domains/seal/tools.js";
import { CorpConfig } from "./core/config/types.js";
import { clearCorpTokenCache } from "./core/auth/token-store.js";

const VERSION = "0.3.0";
const APP_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const STATE_DIR = join(homedir(), ".config", "seal-home");
const SERVICE_PID_FILE = join(STATE_DIR, "service.pid");
const SERVICE_LOG_FILE = join(STATE_DIR, "service.log");
const CURRENT_CORP_FILE = join(STATE_DIR, "current-corp");

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
    const currentCorpId = corpId ?? readCurrentCorpId() ?? corps[0]?.id;
    printJson(corps.map((item) => ({
      id: item.id,
      name: item.name,
      sourceType: item.source.type,
      current: item.id === currentCorpId
    })));
    return;
  }

  if (area === "corps" && action === "current") {
    const corp = selectCorp("");
    printJson({
      id: corp.id,
      name: corp.name,
      sourceType: corp.source.type
    });
    return;
  }

  if (area === "corps" && action === "switch") {
    const corpId = maybeName;
    if (!corpId) throw new Error("Usage: seal-home corps switch <corpId>");
    const corp = selectCorp(corpId);
    ensureStateDir();
    writeFileSync(CURRENT_CORP_FILE, `${corp.id}\n`, { mode: 0o600 });
    printJson({
      current: true,
      id: corp.id,
      name: corp.name
    });
    return;
  }

  if (area === "corps" && action === "add-hose") {
    await addHoseCorp(jsonObject(args.json));
    return;
  }

  const corp = selectCorp(String(args.options.corp ?? ""));

  if (area === "source" && action === "config") {
    printJson(await resolveLiveSealEnterpriseConfig(corp));
    return;
  }

  if (area === "auth" && action === "diagnose") {
    printJson(await diagnoseAuth(corp));
    return;
  }

  const client = await createSealClient(corp);

  if (area === "context") {
    await runTool("seal_approval_context_get", client, corp, {
      documentLimit: numberOption(args.options.documentLimit),
      ...ruleVersionContextOptions(stringOption(args.options.ruleVersion))
    });
    return;
  }

  if (area === "rules" && action === "versions") {
    await runTool("seal_approval_rule_versions_list", client, corp, {});
    return;
  }

  if (area === "rules" && action === "version") {
    const version = maybeName ?? stringOption(args.options.version);
    if (!version) throw new Error("Usage: seal-home rules version <versionId|versionNumber|latest>");
    await runTool("seal_approval_rule_version_get", client, corp, parseRuleVersionSelector(version));
    return;
  }

  if (area === "rules" && action === "search") {
    const keyword = maybeName ?? stringOption(args.options.query);
    if (!keyword) throw new Error("Usage: seal-home rules search <keyword> [--version <versionId|versionNumber|latest>]");
    await runTool("seal_approval_search", client, corp, {
      keywords: [keyword],
      areas: ["rules"],
      maxResults: numberOption(args.options.maxResults),
      contextLines: numberOption(args.options.contextLines),
      refresh: booleanOption(args.options.refresh),
      ...ruleVersionSearchOptions(stringOption(args.options.version))
    });
    return;
  }

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

  if (area === "approval-runs" && action === "pick") {
    const query = maybeName ?? stringOption(args.options.query);
    if (!query) throw new Error("Usage: seal-home approval-runs pick <documentSN-or-query>");
    await runTool("seal_approval_run_pick", client, corp, {
      query,
      limit: numberOption(args.options.limit),
      includeBridge: booleanOption(args.options.includeBridge)
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
  const selectedCorpId = corpId || readCurrentCorpId() || "";
  const corp = selectedCorpId
    ? corps.find((item) => item.id === selectedCorpId)
    : corps[0];

  if (!corp) {
    throw new Error(
      selectedCorpId
        ? `No enterprise config found for ${selectedCorpId}`
        : `No enterprise config found. Add a non-example JSON file under one of: ${getEnterprisesDirCandidates().join(", ")}`
    );
  }

  return corp;
}

function readCurrentCorpId(): string | undefined {
  if (!existsSync(CURRENT_CORP_FILE)) return undefined;
  const value = readFileSync(CURRENT_CORP_FILE, "utf-8").trim();
  return value || undefined;
}

async function addHoseCorp(input: Record<string, unknown>) {
  const nameInput = optionalString(input, "name");
  const appKey = requiredString(input, "appKey");
  const appSecurity = requiredString(input, "appSecurity");
  const staffId = requiredStringAlias(input, ["staffId", "proxyStaffBizId"]);
  const corpIdInput =
    optionalString(input, "corpId") ??
    optionalString(input, "corporationId");
  const domain = optionalString(input, "domain") ?? "https://app.ekuaibao.com";
  const verify = input.force === true || input.verify === false ? false : true;
  const remote = corpIdInput && !verify
    ? undefined
    : await resolveHoseCorporation(domain, appKey, appSecurity);
  const corpId = corpIdInput ?? remote?.id ?? (!verify ? inferCorpIdFromStaffId(staffId) : undefined);
  if (!corpId) {
    throw new Error(
      "Missing required JSON field: corpId. Hose login did not return corporationId. Pass force:true to infer it from proxyStaffBizId."
    );
  }
  const id = optionalString(input, "id") ?? corpId;
  const name = nameInput ?? remote?.name ?? corpId;
  const sealUrl = optionalString(input, "sealUrl") ?? `https://${corpId.toLowerCase()}.sealai.cc`;

  const config: CorpConfig = {
    id,
    name,
    seal: {
      url: sealUrl,
      endpoints: {
        approvalStylePreferences: "api/v1/agent/ai-approval/config"
      }
    },
    source: {
      type: "hose",
      domain,
      appKey,
      appSecurity,
      corpId,
      staffId
    },
    auth: {
      refreshTtl: 300
    }
  };

  if (verify) {
    clearCorpTokenCache(id);
    await resolveLiveSealEnterpriseConfig(config);
  }

  const enterprisesDir = resolveWritableEnterprisesDir();
  mkdirSync(enterprisesDir, { recursive: true, mode: 0o700 });
  const file = join(enterprisesDir, `${safeFileName(id)}.json`);
  if (existsSync(file) && input.overwrite !== true) {
    throw new Error(`Enterprise config already exists: ${file}. Pass "overwrite": true to replace it.`);
  }

  writeFileSync(file, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  printJson({
    id,
    name,
    corpId,
    verified: verify,
    path: file
  });
}

async function diagnoseAuth(corp: CorpConfig) {
  if (corp.source.type !== "hose") {
    const client = await createSealClient(corp);
    const me = await getMe(client);
    return {
      corp: {
        id: corp.id,
        name: corp.name,
        sourceType: corp.source.type
      },
      ok: true,
      stages: [
        {
          name: "seal.whoami",
          ok: true,
          user: me.user,
          tenant: me.tenant
        }
      ]
    };
  }

  clearCorpTokenCache(corp.id);
  const source = corp.source;
  const appKey = source.appKey ?? source.key;
  const appSecurity = source.appSecurity ?? source.password;
  const sealUrl = (corp.seal.url ?? source.sealUrl ?? `https://${source.corpId.toLowerCase()}.sealai.cc`).replace(/\/+$/, "");
  const uid = source.staffId.includes(":") ? source.staffId : `${source.corpId}:${source.staffId}`;
  const stages: Array<Record<string, unknown>> = [];

  if (!appKey || !appSecurity) {
    return {
      corp: {
        id: corp.id,
        name: corp.name,
        sourceType: corp.source.type
      },
      ok: false,
      stages: [
        {
          name: "hose.openapi",
          ok: false,
          error: "Hose source requires appKey/key and appSecurity/password"
        }
      ]
    };
  }

  const openapi = await runDiagnoseStage("hose.openapi", async () => {
    const json = await postJson(`${source.domain.replace(/\/+$/, "")}/api/openapi/v1/auth/getAccessToken`, {
      appKey,
      appSecurity
    });
    const value = objectValue(json.value);
    const token = stringValue(value.accessToken) ?? stringValue(json.accessToken) ?? stringValue(json.token);
    if (!token) throw new Error("Hose login did not return an access token");
    return {
      token,
      public: {
        corporationId: stringValue(value.corporationId) ?? stringValue(objectValue(value.corporation).id),
        expireTime: numberValue(value.expireTime)
      }
    };
  });
  stages.push(openapi.public);

  const openapiToken = openapi.private?.token;
  const provisional = openapiToken
    ? await runDiagnoseStage("hose.provisional", async () => {
      const json = await postJson(
        `${source.domain.replace(/\/+$/, "")}/api/openapi/v1.1/provisional/getProvisionalAuth?accessToken=${encodeURIComponent(openapiToken)}`,
        {
          uid,
          pageType: "home",
          expireDate: 7200
        }
      );
      const url = stringValue(objectValue(json.value).message);
      if (!url) throw new Error("Hose CloseAPI did not return a provisional auth URL");
      const token = new URL(url).searchParams.get("accessToken");
      if (!token) throw new Error("Hose provisional auth URL did not include accessToken");
      return {
        token,
        public: {
          uid,
          hasProvisionalUrl: true
        }
      };
    })
    : skippedStage("hose.provisional");
  stages.push(provisional.public);

  const provisionalToken = provisional.private?.token;
  const sealSession = provisionalToken
    ? await runDiagnoseStage("seal.sso", async () => {
      const json = await getJson(
        `${sealUrl}/api/auth/oauth2/session/oem-hosecloud?token=${encodeURIComponent(provisionalToken)}&returnToken=1`
      );
      const data = objectValue(json.data);
      const token =
        stringValue(json.token) ??
        stringValue(json.accessToken) ??
        stringValue(data.token) ??
        stringValue(data.accessToken);
      if (!token) throw new Error("Seal SSO did not return a bearer token");
      return {
        token,
        public: {
          sealUrl,
          expiresIn: numberValue(json.expiresIn) ?? numberValue(json.expires_in) ?? numberValue(data.expiresIn) ?? numberValue(data.expires_in)
        }
      };
    })
    : skippedStage("seal.sso");
  stages.push(sealSession.public);

  const sealToken = sealSession.private?.token;
  const whoami = sealToken
    ? await runDiagnoseStage("seal.whoami", async () => {
      const json = await getJson(`${sealUrl}/api/v1/auth/me`, {
        authorization: `Bearer ${sealToken}`
      });
      const data = objectValue(json.data);
      const user = objectValue(data.user ?? json.user);
      const tenant = objectValue(data.tenant ?? json.tenant);
      return {
        public: {
          user: {
            id: stringValue(user.id),
            name: stringValue(user.name),
            isAdmin: booleanValue(user.isAdmin),
            providerUserId: stringValue(user.providerUserId)
          },
          tenant: {
            id: stringValue(tenant.id),
            name: stringValue(tenant.name),
            tenantSlug: stringValue(tenant.tenantSlug),
            hoseCorpConfig: summarizeHoseCorpConfig(tenant.hoseCorpConfig)
          }
        }
      };
    })
    : skippedStage("seal.whoami");
  stages.push(whoami.public);

  return {
    corp: {
      id: corp.id,
      name: corp.name,
      sourceType: corp.source.type
    },
    ok: stages.every((stage) => stage.ok === true),
    stages
  };
}

type DiagnoseStageResult = {
  public: Record<string, unknown>;
  private?: {
    token?: string;
  };
};

async function runDiagnoseStage(
  name: string,
  action: () => Promise<{ public: Record<string, unknown>; token?: string }>
): Promise<DiagnoseStageResult> {
  try {
    const result = await action();
    return {
      public: {
        name,
        ok: true,
        ...compactObject(result.public)
      },
      private: result.token ? { token: result.token } : undefined
    };
  } catch (error) {
    return {
      public: {
        name,
        ok: false,
        error: redactSensitiveText(error instanceof Error ? error.message : String(error))
      }
    };
  }
}

function skippedStage(name: string): DiagnoseStageResult {
  return {
    public: {
      name,
      ok: false,
      skipped: true
    }
  };
}

async function postJson(url: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify(body)
  });
  return parseJsonResponse(response);
}

async function getJson(url: string, headers: Record<string, string> = {}): Promise<Record<string, unknown>> {
  const response = await fetch(url, {
    headers
  });
  return parseJsonResponse(response);
}

async function parseJsonResponse(response: Response): Promise<Record<string, unknown>> {
  const body = await response.text();
  if (!response.ok) {
    throw new Error(`${response.status} ${body}`);
  }
  const json = JSON.parse(body) as unknown;
  return objectValue(json);
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function booleanValue(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function summarizeHoseCorpConfig(value: unknown) {
  const config = objectValue(value);
  return compactObject({
    corporationId: stringValue(config.corporationId),
    corporationName: stringValue(config.corporationName)
  });
}

function compactObject<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined)
  ) as T;
}

function requiredString(input: Record<string, unknown>, key: string): string {
  const value = optionalString(input, key);
  if (!value) throw new Error(`Missing required JSON field: ${key}`);
  return value;
}

function requiredStringAlias(input: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = optionalString(input, key);
    if (value) return value;
  }
  throw new Error(`Missing required JSON field: ${keys.join(" or ")}`);
}

function optionalString(input: Record<string, unknown>, key: string): string | undefined {
  const value = input[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function inferCorpIdFromStaffId(staffId: string): string | undefined {
  const [corpId] = staffId.split(":", 1);
  return corpId || undefined;
}

async function resolveHoseCorporation(domain: string, appKey: string, appSecurity: string) {
  const response = await fetch(`${domain.replace(/\/+$/, "")}/api/openapi/v1/auth/getAccessToken`, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({
      appKey,
      appSecurity
    })
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Hose login failed: ${response.status}${body ? ` ${body}` : ""}`);
  }

  const data = await response.json() as {
    value?: {
      corporationId?: string;
      corporation?: {
        id?: string;
        name?: string;
      };
    };
  };
  const corporationId = data.value?.corporationId ?? data.value?.corporation?.id;
  return corporationId
    ? {
      id: corporationId,
      name: data.value?.corporation?.name
    }
    : undefined;
}

function safeFileName(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, "_");
}

function parseRuleVersionSelector(value: string) {
  if (value === "latest") return { latest: true };
  const versionNumber = Number(value);
  if (Number.isInteger(versionNumber) && versionNumber > 0) {
    return { versionNumber };
  }
  return { versionId: value };
}

function ruleVersionSearchOptions(value?: string) {
  if (!value) return {};
  const selector = parseRuleVersionSelector(value);
  if ("latest" in selector) {
    return {
      ruleVersionScope: "version",
      latestRuleVersion: true
    };
  }
  if ("versionNumber" in selector) {
    return {
      ruleVersionScope: "version",
      ruleVersionNumber: selector.versionNumber
    };
  }
  return {
    ruleVersionScope: "version",
    ruleVersionId: selector.versionId
  };
}

function ruleVersionContextOptions(value?: string) {
  if (!value) return {};
  const selector = parseRuleVersionSelector(value);
  if ("latest" in selector) {
    return { latestRuleVersion: true };
  }
  if ("versionNumber" in selector) {
    return { ruleVersionNumber: selector.versionNumber };
  }
  return { ruleVersionId: selector.versionId };
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
  seal-home corps current
  seal-home corps switch <corpId>
  seal-home corps add-hose --json '{"name":"企业名称","domain":"https://app.ekuaibao.com","appKey":"...","appSecurity":"...","proxyStaffBizId":"corpId:staffId"}'
  seal-home auth diagnose [--corp <corpId>]
  seal-home source config [--corp <corpId>]
  seal-home tool <toolName> [--corp <corpId>] [--json '{"key":"value"}']
  seal-home rules versions [--corp <corpId>]
  seal-home rules version <versionId|versionNumber|latest> [--corp <corpId>]
  seal-home rules search <keyword> [--version <versionId|versionNumber|latest>] [--maxResults 20]
  seal-home context [--ruleVersion <versionId|versionNumber|latest>] [--documentLimit 50]
  seal-home approval-runs summary [--date YYYY-MM-DD] [--timezone Asia/Shanghai]
  seal-home approval-runs search [--query text] [--humanResult 驳回] [--manualApprovalStatus TERMINATED] [--startDate ms] [--endDate ms] [--limit 20] [--includeBridge true]
  seal-home approval-runs pick <documentSN-or-query> [--limit 20]
  seal-home approval-runs get <recordId>
  seal-home approval-runs bridge [--sourceDocumentSN B26001887]
  seal-home simulation batch-records <batchId>
`);
}

main().catch((error) => {
  console.error(redactSensitiveText(error instanceof Error ? error.message : String(error)));
  process.exit(1);
});

function redactSensitiveText(value: string): string {
  return value
    .replace(/([?&](?:accessToken|token|returnToken)=)[^&\s]+/gi, "$1<redacted>")
    .replace(/(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi, "$1<redacted>");
}
