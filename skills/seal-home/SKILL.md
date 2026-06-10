---
name: seal-home
description: Use when working with Seal Home approval automation, seal-home CLI or MCP tools, approval rules and documents, approval run history, simulations, enterprise auth diagnostics, and Langfuse trace hints.
metadata:
  short-description: Seal approval automation tools
---

# Seal Home

## Quick Start

Use the global `seal-home` CLI. It should work from any directory after installation:

```bash
seal-home help
seal-home version
seal-home tools list
```

Use CLI for broad or detailed operations. The CLI intentionally exposes the full fine-grained tool list and is the primary interface for shared/public use.

Enterprise configs are loaded from `SEAL_HOME_ENTERPRISES_DIR` when it is set. Otherwise `./enterprises` and `~/.config/seal-home/enterprises` are merged, with user-level configs overriding same-ID local configs. Prefer user-level config for shared/public installs so commands do not depend on the repository working directory.

Optional local service commands:

```bash
seal-home service start
seal-home service status
seal-home service restart
seal-home service stop
seal-home update
```

Use `seal-home update` after pulling new versions; it restarts the service if it was running so new code is picked up.

## Decision Guide

- For current identity or tenant: use `seal-home tool seal_whoami`.
- For configured enterprises: use `seal-home corps list`.
- For Hose login, SSO, or "Unable to connect" authentication failures: use `seal-home auth diagnose [--corp <corpId>]`.
- For source-derived enterprise config: use `seal-home source config`.
- For daily approval run questions: use `seal-home approval-runs summary --date YYYY-MM-DD --timezone Asia/Shanghai`.
- For approval run lookup by document SN, ID, status, mode, or trace: use `seal-home approval-runs search`.
- For Hose enterprise assist links: use `seal-home approval-runs url`; add `<recordId>` or `--sourceDocumentSN B26001887` when a document link is also needed.
- For Langfuse lookup hints: use `seal-home approval-runs bridge`.
- For one simulation batch: use `seal-home simulation batch-records <batchId>`.
- For approval rule/document/style maintenance: use `seal-home tool <toolName> --json '{...}'`.

## Task Playbooks

### Diagnose Hose authentication

Use when a Hose/合思 sourced enterprise cannot log in, `seal_whoami` fails, or an agent needs to verify a newly added enterprise config.

```bash
seal-home auth diagnose --corp <corpId>
```

Read the JSON `stages` in order:

- `hose.openapi`: appKey/appSecurity can get a Hose OpenAPI token and corporation ID.
- `hose.provisional`: `proxyStaffBizId`/staff ID can get a provisional auth URL.
- `seal.sso`: Seal accepts the Hose provisional token and returns a bearer session.
- `seal.whoami`: the Seal bearer can read current user and tenant.

Do not expect tokens in the output; the command intentionally redacts or omits them. If a stage fails, report that stage and its error, then stop assuming later stages worked.

### Diagnose one approval document

Use when the user gives a 合思/易快报单号, Seal source document SN, source document ID, or asks why one approval did or did not pass.

1. Search runs:

```bash
seal-home approval-runs search --query <document-or-trace-key> --limit 50
```

2. If a likely record is found, get bridge hints:

```bash
seal-home approval-runs bridge --sourceDocumentSN <sourceDocumentSN>
```

3. Report `status`, `taskMode`, `finalExecutionMode`, `recordId`, `simulationBatchId`, `langfuseTraceId`, and `langfuseSessionFallback`. If `langfuseTraceId` is absent, tell the caller to use the session fallback.

### Summarize one day of approval runs

Use explicit local date and timezone:

```bash
seal-home approval-runs summary --date YYYY-MM-DD --timezone Asia/Shanghai --limit 100
```

Report matched count, status counts, task mode counts, and the most relevant failed or simulated records. If `matched` is unexpectedly low, rerun with broader `limit` or targeted `query`.

### Inspect a simulation batch

```bash
seal-home simulation batch-records <batchId>
```

Summarize count, statuses, source document identifiers, and bridge hints. For failures, preserve record IDs so another tool can inspect the trace.

### Search approval knowledge

Use for "which rule/document mentions X" or before changing rule/document content:

```bash
seal-home tool seal_approval_search --json '{"keywords":["关键词"],"matchMode":"any","maxResults":20}'
```

Use `areas` to narrow to `rules`, `documents`, or `preferences`. Separate CLI invocations are short-lived processes and do not share in-memory search caches. Use the local service as the restartable long-lived process for future cached workflows.

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
seal-home tool seal_approval_style_preferences_get
```

Then update only explicit fields:

```bash
seal-home tool seal_approval_style_preferences_update --json '{"tone":"...","language":"..."}'
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

## CLI Patterns

Read `references/cli.md` when you need the full tool list, parameter examples, or maintenance commands.

Preferred command forms:

```bash
seal-home approval-runs summary --date 2026-06-09 --timezone Asia/Shanghai
seal-home approval-runs search --query B26001887 --limit 20 --includeBridge true
seal-home approval-runs url
seal-home approval-runs url --sourceDocumentSN B26001887
seal-home approval-runs bridge --sourceDocumentSN B26001887
seal-home tool seal_approval_search --json '{"keywords":["差旅","发票"],"areas":["rules","documents"]}'
```

## Output Handling

CLI output is JSON on stdout. Parse JSON instead of scraping text. Keep broad responses compact: avoid `includeBridge true` unless trace/session bridge rows are needed.

For date-based questions, use explicit dates and timezone. Default timezone is usually `Asia/Shanghai`; pass it explicitly when answering business questions.

## Safety

Rule, document, style preference, and publish actions mutate Seal configuration. Before running write operations, make sure the target enterprise is clear and the requested payload is explicit. Prefer listing or fetching the current state before update/delete/publish.

For public or shared use, assume the CLI runs locally with the user's own credentials. Do not send real `enterprises/*.json` files to GitHub, chat, logs, or tickets.
