# Seal Home CLI Reference

Run from any directory after installing the global CLI:

```bash
seal-home <command>
```

Enterprise config lookup:

- If `SEAL_HOME_ENTERPRISES_DIR` is set, only that directory is loaded.
- Otherwise `./enterprises` and `~/.config/seal-home/enterprises` are merged.
- User-level configs override same-ID local configs.

## Top-Level Commands

```bash
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
seal-home auth hose-link [--corp <corpId>] [--expire 7200]
seal-home source config [--corp <corpId>]
seal-home tool <toolName> [--corp <corpId>] [--json '{"key":"value"}']
seal-home approval-runs summary [--date YYYY-MM-DD] [--timezone Asia/Shanghai]
seal-home approval-runs search [--query text] [--limit 20] [--includeBridge true]
seal-home approval-runs get <recordId> [--fields metadata|document.fields,result.summary] [--output-file file.json]
seal-home approval-runs attachments <recordId>
seal-home approval-runs attachment-dispute --sn <sourceDocumentSN> --keywords keyword1,keyword2
seal-home approval-runs result <recordId> [--summary]
seal-home approval-runs url
seal-home approval-runs url <recordId>
seal-home approval-runs url --sourceDocumentSN <sourceDocumentSN>
seal-home approval-runs bridge [--sourceDocumentSN <sourceDocumentSN>]
seal-home simulation batch-records <batchId>
```

## Fine-Grained Tools

`seal-home version` returns:

```json
{
  "name": "seal-home",
  "version": "0.3.0"
}
```

`seal-home service status` returns the PID, version, state directory, PID file, and log file for the optional local background process.

`seal-home update` updates the git checkout, runs `bun install`, and restarts the local service if it was running.

Identity and session:

- `seal-home auth diagnose [--corp <corpId>]`
- `seal_whoami`
- `seal_session_get`

Approval rule maintenance:

- `seal-home rules count [--corp <corpId>]`
- `seal-home rules list --summary [--corp <corpId>]`
- `seal_approval_rules_list`
- `seal_approval_rule_create`
- `seal_approval_rule_update`
- `seal_approval_rule_delete`
- `seal_approval_rule_versions_list`
- `seal_approval_rule_version_publish`

Approval run lightweight queries:

- `seal-home approval-runs get <recordId> --fields metadata`
- `seal-home approval-runs get <recordId> --summary`
- `seal-home approval-runs pick --sn <单号> --batch <batchId> --latest`
- `seal-home approval-runs document-summary <recordId>`
- `seal-home approval-runs cited-rules <recordId>`
- `seal-home approval-runs get <recordId> --fields document.fields,result.summary`
- `seal-home approval-runs attachments <recordId> --summary`
- `seal-home approval-runs attachment-dispute --sn <单号> --keywords 关键词1,关键词2`
- `seal-home approval-runs result <recordId> --summary`
- `seal_approval_run_get` with `fields`
- `seal_approval_run_pick`
- `seal_approval_run_cited_rules_get`
- `seal_approval_run_document_summary_get`
- `seal_approval_run_attachments_get`
- `seal_approval_run_attachment_dispute`
- `seal_approval_run_result_get` with `{"summary":true}`

Approval knowledge documents:

- `seal_approval_documents_list`
- `seal_approval_document_get`
- `seal_approval_document_create`
- `seal_approval_document_update`

Approval search and context:

- `seal_approval_search`
- `seal_approval_context_get`
- `seal-home rules get --version <number> --code '#0038'`
- `seal-home rules get --record-id <recordId> --runtime-id rule-205`

Style preferences:

- `seal_approval_style_preferences_get`
- `seal_approval_style_preferences_update`

Approval runs, simulations, and Langfuse bridge:

- `seal_approval_runs_search`
- `seal_approval_runs_summary`
- `seal_simulation_batch_records_get`
- `seal_approval_run_langfuse_bridge_get`

## Common Examples

Add and verify a Hose enterprise:

```bash
seal-home corps add-hose --json '{"name":"企业名称","domain":"https://app.ekuaibao.com","appKey":"...","appSecurity":"...","proxyStaffBizId":"corpId:staffId"}'
seal-home auth diagnose --corp <corpId>
```

Force-write a Hose config without verification:

```bash
seal-home corps add-hose --json '{"name":"企业名称","domain":"https://app.ekuaibao.com","appKey":"...","appSecurity":"...","proxyStaffBizId":"corpId:staffId","force":true}'
```

Diagnose auth failures:

```bash
seal-home auth diagnose --corp <corpId>
```

The diagnostic stages are `hose.openapi`, `hose.provisional`, `seal.sso`, and `seal.whoami`. Tokens are omitted from output.

Search approval content:

```bash
seal-home tool seal_approval_search --json '{"keywords":["关键词"],"matchMode":"any","maxResults":20}'
```

Get aggregated approval context:

```bash
seal-home tool seal_approval_context_get --json '{"documentLimit":20}'
```

Create a draft approval rule:

```bash
seal-home tool seal_approval_rule_create --json '{"description":"规则描述","scope":"适用场景","strictness":"SHOULD_FOLLOW"}'
```

Update an approval document:

```bash
seal-home tool seal_approval_document_update --json '{"documentId":"doc-id","content":"Markdown 内容"}'
```

Summarize one local date:

```bash
seal-home approval-runs summary --date 2026-06-09 --timezone Asia/Shanghai --limit 100
```

Find a run and include Langfuse bridge rows:

```bash
seal-home approval-runs search --query <sourceDocumentSN> --limit 20 --includeBridge true
```

Resolve Langfuse trace/session hints:

```bash
seal-home approval-runs bridge --sourceDocumentSN <sourceDocumentSN>
```

Read simulation batch records:

```bash
seal-home simulation batch-records <batchId>
```

## Write Operation Payloads

Create a rule:

```json
{
  "description": "规则描述",
  "scope": "适用场景",
  "strictness": "MUST_FOLLOW | SHOULD_FOLLOW | SUGGESTION"
}
```

Update a rule:

```json
{
  "ruleId": "rule-id",
  "description": "可选",
  "scope": "可选",
  "strictness": "SHOULD_FOLLOW"
}
```

Publish a rule version:

```json
{
  "versionName": "版本名称"
}
```

Create a document:

```json
{
  "title": "标题",
  "purpose": "用途",
  "content": "Markdown 内容",
  "contentType": "text/markdown",
  "status": "可选",
  "scenarios": ["场景"],
  "tags": ["标签"]
}
```

Update a document:

```json
{
  "documentId": "doc-id",
  "title": "可选",
  "purpose": "可选",
  "content": "可选",
  "enabled": true,
  "scenarios": ["可选"],
  "tags": ["可选"]
}
```

Update style preferences:

```json
{
  "tone": "可选",
  "language": "可选",
  "detailLevel": "可选",
  "outputFormat": "可选",
  "examples": ["可选"],
  "prohibitedPhrases": ["可选"],
  "customInstructions": "可选"
}
```

## Failure Handling

- CLI commands are short-lived processes. In-memory auth/search caches only live for that single process. Use `seal-home service restart` after updates so the optional local service picks up new code.
- If no run is found by `sourceDocumentSN`, retry with `sourceDocumentId` or a broader `query`.
- If date-based summaries look wrong, pass `--timezone Asia/Shanghai` and an explicit `--date`.
- If `langfuseTraceId` is missing, use `langfuseSessionFallback`.
- If a write operation fails, report the raw JSON error and do not retry with guessed payloads.
