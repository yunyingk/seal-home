# Seal Home CLI Reference

Run from the repository root:

```bash
bun run cli -- <command>
```

## Top-Level Commands

```bash
bun run cli -- version
bun run cli -- tools list
bun run cli -- corps list [--corp <corpId>]
bun run cli -- source config [--corp <corpId>]
bun run cli -- tool <toolName> [--corp <corpId>] [--json '{"key":"value"}']
bun run cli -- approval-runs summary [--date YYYY-MM-DD] [--timezone Asia/Shanghai]
bun run cli -- approval-runs search [--query text] [--limit 20] [--includeBridge true]
bun run cli -- approval-runs bridge [--sourceDocumentSN B26001887]
bun run cli -- simulation batch-records <batchId>
```

## Fine-Grained Tools

`bun run cli -- version` returns:

```json
{
  "name": "seal-home",
  "version": "0.3.0"
}
```

Identity and session:

- `seal_whoami`
- `seal_session_get`

Approval rule maintenance:

- `seal_approval_rules_list`
- `seal_approval_rule_create`
- `seal_approval_rule_update`
- `seal_approval_rule_delete`
- `seal_approval_rule_versions_list`
- `seal_approval_rule_version_publish`

Approval knowledge documents:

- `seal_approval_documents_list`
- `seal_approval_document_get`
- `seal_approval_document_create`
- `seal_approval_document_update`

Approval search and context:

- `seal_approval_search`
- `seal_approval_context_get`

Style preferences:

- `seal_approval_style_preferences_get`
- `seal_approval_style_preferences_update`

Approval runs, simulations, and Langfuse bridge:

- `seal_approval_runs_search`
- `seal_approval_runs_summary`
- `seal_simulation_batch_records_get`
- `seal_approval_run_langfuse_bridge_get`

## Common Examples

Search approval content:

```bash
bun run cli -- tool seal_approval_search --json '{"keywords":["关键词"],"matchMode":"any","maxResults":20}'
```

Get aggregated approval context:

```bash
bun run cli -- tool seal_approval_context_get --json '{"documentLimit":20}'
```

Create a draft approval rule:

```bash
bun run cli -- tool seal_approval_rule_create --json '{"description":"规则描述","scope":"适用场景","strictness":"SHOULD_FOLLOW"}'
```

Update an approval document:

```bash
bun run cli -- tool seal_approval_document_update --json '{"documentId":"doc-id","content":"Markdown 内容"}'
```

Summarize one local date:

```bash
bun run cli -- approval-runs summary --date 2026-06-09 --timezone Asia/Shanghai --limit 100
```

Find a run and include Langfuse bridge rows:

```bash
bun run cli -- approval-runs search --query B26001887 --limit 20 --includeBridge true
```

Resolve Langfuse trace/session hints:

```bash
bun run cli -- approval-runs bridge --sourceDocumentSN B26001887
```

Read simulation batch records:

```bash
bun run cli -- simulation batch-records <batchId>
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

- CLI commands are short-lived processes. In-memory auth/search caches only live for that single process. The MCP server is long-lived, so it can reuse in-memory caches across tool calls until refresh or TTL expiry.
- If no run is found by `sourceDocumentSN`, retry with `sourceDocumentId` or a broader `query`.
- If date-based summaries look wrong, pass `--timezone Asia/Shanghai` and an explicit `--date`.
- If `langfuseTraceId` is missing, use `langfuseSessionFallback`.
- If a write operation fails, report the raw JSON error and do not retry with guessed payloads.
