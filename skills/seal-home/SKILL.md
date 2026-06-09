---
name: seal-home
description: Use when working with Seal Home / seal-home approval automation: querying Seal enterprise identity, approval rules, approval knowledge documents, approval style preferences, approval run history, simulation batch records, and Langfuse trace/session bridge hints. Prefer this skill when the user mentions Seal, seal_home MCP, 合思/易快报 approval runs, approval rule/document maintenance, approval simulations, or debugging Seal approval execution traces.
---

# Seal Home

## Quick Start

Run commands from the seal-home repository root:

```bash
bun run cli -- help
bun run cli -- tools list
```

Use CLI for broad or detailed operations. Use MCP for narrow, high-frequency agent entry points only. The CLI intentionally exposes the full fine-grained tool list; MCP intentionally advertises a small surface to reduce model context.

## Decision Guide

- For current identity or tenant: use `bun run cli -- tool seal_whoami`.
- For configured enterprises: use `bun run cli -- corps list`.
- For source-derived enterprise config: use `bun run cli -- source config`.
- For daily approval run questions: use `bun run cli -- approval-runs summary --date YYYY-MM-DD --timezone Asia/Shanghai`.
- For approval run lookup by document SN, ID, status, mode, or trace: use `bun run cli -- approval-runs search`.
- For Langfuse lookup hints: use `bun run cli -- approval-runs bridge`.
- For one simulation batch: use `bun run cli -- simulation batch-records <batchId>`.
- For approval rule/document/style maintenance: use `bun run cli -- tool <toolName> --json '{...}'`.

## Task Playbooks

### Diagnose one approval document

Use when the user gives a 合思/易快报单号, Seal source document SN, source document ID, or asks why one approval did or did not pass.

1. Search runs:

```bash
bun run cli -- approval-runs search --query <document-or-trace-key> --limit 50
```

2. If a likely record is found, get bridge hints:

```bash
bun run cli -- approval-runs bridge --sourceDocumentSN <sourceDocumentSN>
```

3. Report `status`, `taskMode`, `finalExecutionMode`, `recordId`, `simulationBatchId`, `langfuseTraceId`, and `langfuseSessionFallback`. If `langfuseTraceId` is absent, tell the caller to use the session fallback.

### Summarize one day of approval runs

Use explicit local date and timezone:

```bash
bun run cli -- approval-runs summary --date YYYY-MM-DD --timezone Asia/Shanghai --limit 100
```

Report matched count, status counts, task mode counts, and the most relevant failed or simulated records. If `matched` is unexpectedly low, rerun with broader `limit` or targeted `query`.

### Inspect a simulation batch

```bash
bun run cli -- simulation batch-records <batchId>
```

Summarize count, statuses, source document identifiers, and bridge hints. For failures, preserve record IDs so another tool can inspect the trace.

### Search approval knowledge

Use for "which rule/document mentions X" or before changing rule/document content:

```bash
bun run cli -- tool seal_approval_search --json '{"keywords":["关键词"],"matchMode":"any","maxResults":20}'
```

Use `areas` to narrow to `rules`, `documents`, or `preferences`. Use `refresh:true` when recent edits may not be reflected in the in-memory cache.

### Update approval rules

Write workflow:

1. Read current rules with `seal_approval_rules_list` or `seal_approval_context_get`.
2. Identify the exact rule ID or create payload.
3. Present the intended change and ask for confirmation.
4. Run `seal_approval_rule_create`, `seal_approval_rule_update`, or `seal_approval_rule_delete`.
5. Read rules again to verify.
6. Publish only when explicitly requested, using `seal_approval_rule_version_publish` with a clear `versionName`.

### Update approval documents

Write workflow:

1. List or fetch the target document.
2. Present the intended title/purpose/content/status/scenario/tag change.
3. Ask for confirmation.
4. Run `seal_approval_document_create` or `seal_approval_document_update`.
5. Fetch the document again to verify.

There is no dedicated delete command in the current CLI. If deactivation is intended and the API supports it, update with `enabled:false`.

### Update style preferences

Read first:

```bash
bun run cli -- tool seal_approval_style_preferences_get
```

Then update only explicit fields:

```bash
bun run cli -- tool seal_approval_style_preferences_update --json '{"tone":"...","language":"..."}'
```

Verify by reading again.

## Important Fields

- `sourceDocumentSN`: external source document number, often the easiest 合思/易快报 lookup key.
- `sourceDocumentId`: external source document ID.
- `status`: run status such as completed or failed.
- `taskMode`: execution mode category such as assisted or simulation.
- `finalExecutionMode`: final mode chosen by the approval agent.
- `recordId`: Seal approval run record ID.
- `simulationBatchId`: simulation batch identifier when the run came from a batch.
- `langfuseTraceId`: direct Langfuse trace lookup key when present.
- `langfuseSessionFallback`: fallback session key, usually `hosecloud-{sourceDocumentSN}`, when direct trace ID is absent.

## MCP Boundary

The MCP server advertises only these tools:

- `seal_corp_switch`
- `seal_whoami`
- `seal_approval_search`
- `seal_approval_context_get`
- `seal_runs_search`
- `seal_action`

Do not add every backend API operation as an MCP tool. Add stable, frequent read operations directly; route low-frequency management through `seal_action` or CLI.

`seal_action` examples:

```json
{ "action": "help", "payload": { "topic": "rule" } }
{ "action": "rule.create", "payload": { "description": "...", "scope": "...", "strictness": "SHOULD_FOLLOW" } }
{ "action": "doc.update", "payload": { "documentId": "...", "content": "..." } }
{ "action": "runs.summary", "payload": { "date": "2026-06-09", "timezone": "Asia/Shanghai" } }
{ "action": "langfuse.bridge.get", "payload": { "sourceDocumentSN": "B26001887" } }
```

## CLI Patterns

Read `references/cli.md` when you need the full tool list, parameter examples, or maintenance commands.

Preferred command forms:

```bash
bun run cli -- approval-runs summary --date 2026-06-09 --timezone Asia/Shanghai
bun run cli -- approval-runs search --query B26001887 --limit 20 --includeBridge true
bun run cli -- approval-runs bridge --sourceDocumentSN B26001887
bun run cli -- tool seal_approval_search --json '{"keywords":["差旅","发票"],"areas":["rules","documents"]}'
```

## Output Handling

CLI output is JSON on stdout. Parse JSON instead of scraping text. Keep broad responses compact: avoid `includeBridge true` unless trace/session bridge rows are needed.

For date-based questions, use explicit dates and timezone. Default timezone is usually `Asia/Shanghai`; pass it explicitly when answering business questions.

## Safety

Rule, document, style preference, and publish actions mutate Seal configuration. Before running write operations, make sure the target enterprise is clear and the requested payload is explicit. Prefer listing or fetching the current state before update/delete/publish.

For public or shared use, assume the CLI runs locally with the user's own credentials. Do not send real `enterprises/*.json` files to GitHub, chat, logs, or tickets.
