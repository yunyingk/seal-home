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
      "approvalStylePreferences": "api/v1/approval/style-preferences"
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
- `seal_approval_context_get`: read current approval rules, approval documents, and approval style preferences in one call.
- `seal_approval_rules_list`: current draft approval rules.
- `seal_approval_rule_create`, `seal_approval_rule_update`, `seal_approval_rule_delete`: maintain approval rules.
- `seal_approval_rule_versions_list`, `seal_approval_rule_version_publish`: read and publish rule versions.
- `seal_approval_documents_list`, `seal_approval_document_get`, `seal_approval_document_create`, `seal_approval_document_update`: maintain approval documents.
- `seal_approval_style_preferences_get`, `seal_approval_style_preferences_update`: read and update approval style preferences.
