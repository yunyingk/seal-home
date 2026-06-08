# seal-home

Bun + TypeScript MCP server for pulling Seal enterprise approval context from provider credentials.

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

## Tools

- `seal_source_config`: resolve current Seal enterprise config from the configured source.
- `seal_whoami`: current Seal user and tenant.
- `seal_session_get`: current Seal Bearer session and expiration.
- `seal_approval_search`: keyword search across approval rules, documents, approval preferences, and optionally published rule history. Results include area, entity, field, line number, and surrounding context. Search data is cached in memory for 5 minutes.
- `seal_approval_context_get`: read current approval rules, approval documents, and approval style preferences in one call.
- `seal_approval_rules_list`: current draft approval rules.
- `seal_approval_rule_create`, `seal_approval_rule_update`, `seal_approval_rule_delete`: maintain approval rules.
- `seal_approval_rule_versions_list`, `seal_approval_rule_version_publish`: read and publish rule versions.
- `seal_approval_documents_list`, `seal_approval_document_get`, `seal_approval_document_create`, `seal_approval_document_update`: maintain approval documents.
- `seal_approval_style_preferences_get`, `seal_approval_style_preferences_update`: read and update approval style preferences.
- `seal_approval_runs_search`: search the approval run history from `api/v1/approvals`. This is the broad record table for historical runs and returns compact run fields; set `includeBridge` only when full Langfuse bridge rows are needed.
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
