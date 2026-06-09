# seal-home

Version: `0.3.0`

Bun + TypeScript CLI and optional local service for pulling Seal enterprise approval context from provider credentials.

The first provider is Hose/合思: `key`, `password`, `corpId`, `staffId`, and an optional Hose domain. The provider exchanges those credentials for a Seal enterprise session, then the Seal domain tools can read and maintain approval rules, approval documents, and approval style preferences.

`direct` is also available for later sources that already provide a Seal Bearer token.

## Setup

```bash
bun install
cp enterprises/example.hose.json enterprises/local.json
bun run check
bun run probe
bun run start
```

For an already-authenticated Seal source, copy `enterprises/example.direct.json` instead.

## Public Usage

This repository is intended to be published as a macOS local agent toolkit. Users run the global `seal-home` CLI on their own machine with their own enterprise credentials. Do not deploy it as a shared public service without adding authentication, tenant isolation, credential storage, audit logging, and write-operation controls.

Install the global CLI from a checkout:

```bash
git clone <repo-url>
cd seal-home
bun install
bun link
seal-home version
```

Create a user-level Hose enterprise config that works from any directory:

```bash
mkdir -p ~/.config/seal-home/enterprises
seal-home corps add-hose --json '{"name":"企业名称","domain":"https://app.ekuaibao.com","appKey":"...","appSecurity":"...","proxyStaffBizId":"corpId:staffId"}'
seal-home auth diagnose
seal-home tools list
```

`corps add-hose` verifies by default before writing the config. It uses the Hose OpenAPI credential response to derive the corporation ID, then checks provisional auth, Seal SSO, and Seal `whoami`. Pass `"force":true` or `"verify":false` only when you intentionally want to write a config that may fail later.

For custom config locations, set `SEAL_HOME_ENTERPRISES_DIR` to a directory containing non-example `*.json` enterprise config files.

Update an existing checkout:

```bash
seal-home update
```

`seal-home update` runs `git pull --ff-only`, installs dependencies, and restarts the local service if it was running.

Local enterprise config files are ignored by git:

```text
enterprises/*.json
!enterprises/example.*.json
```

The standard Codex skill lives at `skills/seal-home`. Install or copy that folder into a Codex skills directory when you want Codex to invoke the workflow as `$seal-home`.

## CLI

Use the CLI from skills, shell scripts, or agents. CLI intentionally keeps the full fine-grained tool list available through `seal-home tool <toolName>`.

```bash
seal-home version
seal-home config paths
seal-home tools list
seal-home corps list
seal-home auth diagnose
seal-home approval-runs summary --date 2026-06-08 --timezone Asia/Shanghai
seal-home tool seal_approval_runs_summary --json '{"date":"2026-06-08","timezone":"Asia/Shanghai"}'
```

CLI output is JSON on stdout. Errors are written to stderr.

Enterprise config lookup:

- If `SEAL_HOME_ENTERPRISES_DIR` is set, only that directory is loaded.
- Otherwise `./enterprises` and `~/.config/seal-home/enterprises` are merged.
- User-level configs override same-ID configs from `./enterprises`.

Use `seal-home auth diagnose [--corp <corpId>]` when login fails. It reports four stages without printing tokens: `hose.openapi`, `hose.provisional`, `seal.sso`, and `seal.whoami`. A failed stage points to whether the problem is Hose app credentials, staff authorization, Seal SSO/tenant reachability, or Seal user/session access.

## Local Service

For macOS users who want a long-lived local background process and a simple restart point after updates:

```bash
seal-home service start
seal-home service status
seal-home service restart
seal-home service stop
```

Service state is stored under `~/.config/seal-home/`:

- `service.pid`
- `service.log`

The service is intentionally local. It is useful as a stable process lifecycle for future warmed caches and update/restart workflows; normal CLI commands still work without it.

## Enterprise Config

```json
{
  "id": "corp-id",
  "name": "企业名称",
  "seal": {
    "url": "https://corp-id.sealai.cc",
    "endpoints": {
      "approvalStylePreferences": "api/v1/agent/ai-approval/config"
    }
  },
  "source": {
    "type": "hose",
    "domain": "https://app.ekuaibao.com",
    "key": "hose-app-key",
    "password": "hose-app-security",
    "staffId": "hose-staff-id",
    "corpId": "hose-corp-id"
  },
  "auth": {
    "refreshTtl": 300
  }
}
```

## Developer MCP Notes

Most users do not need MCP. The public/shared path is the global `seal-home` CLI plus the optional local service.

For protocol-native development clients, the MCP server intentionally keeps a narrow exported surface:

- `seal_corp_switch`: switch the active local enterprise config.
- `seal_whoami`: current Seal user and tenant.
- `seal_approval_search`: keyword search across approval rules, documents, approval preferences, and optionally published rule history. Results include area, entity, field, line number, and surrounding context. Search data is cached in memory for 5 minutes only within a long-lived process such as the MCP server; separate CLI invocations do not share this cache.
- `seal_approval_context_get`: read current approval rules, approval documents, and approval style preferences in one call.
- `seal_runs_search`: search the approval run history from `api/v1/approvals`. This is the broad record table for historical runs and returns compact run fields; set `includeBridge` only when full Langfuse bridge rows are needed.
- `seal_action`: low-frequency management router. Use `action: "help"` or `payload.topic` to discover actions.

`seal_corps_list`, `seal_source_config`, and older fine-grained tool names are still accepted by the MCP call handler for compatibility, but they are not advertised by MCP `tools/list`.

`seal_action` uses this shape:

```json
{
  "action": "rule.create | rule.update | rule.publish | doc.create | doc.update | runs.summary | langfuse.bridge.get",
  "payload": {}
}
```

## CLI Tools

These tools remain available to the CLI:

- `seal_source_config`: resolve current Seal enterprise config from the configured source.
- `seal_approval_runs_search`: search approval run history and optional bridge rows.
- `seal_session_get`: current Seal Bearer session and expiration.
- `seal_approval_rules_list`: current draft approval rules.
- `seal_approval_rule_create`, `seal_approval_rule_update`, `seal_approval_rule_delete`: maintain approval rules.
- `seal_approval_rule_versions_list`, `seal_approval_rule_version_publish`: read and publish rule versions.
- `seal_approval_documents_list`, `seal_approval_document_get`, `seal_approval_document_create`, `seal_approval_document_update`: maintain approval documents.
- `seal_approval_style_preferences_get`, `seal_approval_style_preferences_update`: read and update approval style preferences.
- `seal_approval_runs_summary`: summarize approval runs by local date and timezone. Use this for daily questions such as "what approval records did Tawen have today"; it returns status/task-mode counts and compact records.
- `seal_simulation_batch_records_get`: read records from one simulation batch via `api/v1/simulation/batch/{batchId}/records`.
- `seal_approval_run_langfuse_bridge_get`: resolve approval run records to Langfuse lookup hints. It prefers `sourceExtendData._langfuseTraceId`; if that is missing, it returns `hosecloud-{sourceDocumentSN}` as the session fallback.

## Approval Run To Langfuse Bridge

Seal approval runs and simulation batch records are treated as two views over the same run data:

- `api/v1/approvals` is the total approval run list. Use it for history search by time, status, task mode, source document SN, or source document ID.
- `api/v1/simulation/batch/{batchId}/records` is the detail list for one simulation batch. Use it when the user is already looking at a simulation batch.

The useful join fields for Langfuse work are:

- `sourceDocumentSN`
- `sourceDocumentId`
- `tenantId`
- `agentId`
- approval run `id`
- `sourceExtendData._langfuseTraceId`
- `sourceExtendData.simulation_batch_id`

When `_langfuseTraceId` exists, downstream tools should fetch the trace directly. When it is absent, use `hosecloud-{sourceDocumentSN}` as the Langfuse session fallback.

## Engineering Notes

- Prefer Bun-native commands in this repository: `bun run check`, `bun test`, and `seal-home ...`. `npm run check` may work, but Bun is the project runtime and lockfile owner.
- Keep CLI entry points thin. Shared behavior belongs in `src/core` and `src/domains`; `src/cli.ts` should only handle command parsing, process lifecycle, and JSON output.
- Do not print diagnostic text to stdout from the MCP server. MCP uses stdout as the protocol stream; use stderr for server diagnostics.
- Keep any MCP exported surface narrow. High-frequency read tools can be direct MCP tools; low-frequency maintenance should go through `seal_action` or CLI commands.
- Prefer CLI or script processing for large tool responses. For daily approval questions, call `seal-home approval-runs summary ...` instead of reading long `seal_approval_runs_search` output manually.
- Keep broad search tools compact by default. Add explicit opt-in flags such as `includeBridge` for verbose fields that are useful only in deeper debugging.
- When Seal API timestamp filters are uncertain, filter again in tool code by `createdAt` and explicit timezone before presenting date-based answers.
