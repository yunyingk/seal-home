---
name: seal-home
description: Use when working with Seal Home approval automation: 合思/易快报企业认证, Hose authorization links, approval run lookup by 单号/SN/recordId/batch, compact approval run summaries, AI cited rules, document/attachment summaries, approval rules by count/list/version/code/runtime-id, approval knowledge search, simulations, and Langfuse trace hints.
metadata:
  short-description: Seal approval automation tools
---

# Seal Home

Use the global `seal-home` CLI. This skill is a routing layer for agents: keep this file short, choose the right command, and read a focused reference only when the task needs detail.

```bash
seal-home help
seal-home version
seal-home tools list
```

## First Rules

- Prefer compact commands first: `pick`, `--summary`, `--fields`, `attachments --summary`, `rules count`, and `rules list --summary`.
- Parse JSON stdout. Do not scrape human text.
- Do not hand-edit enterprise configs for normal setup. Use `seal-home corps ...`.
- Before write operations on rules, documents, style preferences, or publishing, fetch current state and confirm the intended mutation with the user.
- For date questions, use explicit dates and `--timezone Asia/Shanghai`.
- If output may be large, use `--summary`, `--fields`, `--count`, or `--output-file`; use `--full` only when the user really needs full payloads.

## Route By Intent

- Current tenant or identity: `seal-home tool seal_whoami`.
- Enterprise list/current/switch/add: `seal-home corps ...`; for Hose setup read `references/hose-enterprise-auth.md`.
- Hose login/SSO/auth failures: `seal-home auth diagnose --corp <corpId>`.
- User-facing 合思 authorization link: `seal-home auth hose-link --corp <corpId> --expire 7200`; read `references/hose-enterprise-auth.md`.
- One approval document by 单号/SN: use `seal-home approval-runs pick --sn <单号> --latest`; read `references/approval-run-lightweight.md`.
- One approval run detail: use `approval-runs get <recordId> --summary` or `--fields ...`; read `references/approval-run-lightweight.md`.
- AI used which rules: use `approval-runs cited-rules <recordId>`; read `references/approval-run-lightweight.md`.
- Case/document facts before deep dive: use `approval-runs document-summary <recordId>`.
- Attachments/invoices without full raw document: use `approval-runs attachments <recordId> --summary`.
- Customer disputes OCR, receipt, invoice, image, or attachment findings: read `references/approval-attachment-trace.md`.
- Rules count/list/version lookup: use `rules count`, `rules list --summary`, or `rules get`; read `references/rule-lightweight.md`.
- Rule/document/style maintenance: use fine-grained `seal-home tool <toolName> --json ...`.
- Approval knowledge search: use `seal_approval_search` with `snippetOnly`, `maxChars`, and `fields` when possible; read `references/rule-lightweight.md`.
- Daily run summary: `seal-home approval-runs summary --date YYYY-MM-DD --timezone Asia/Shanghai --limit 100`.
- Simulation batch: `seal-home simulation batch-records <batchId>`.
- Full CLI inventory: read `references/cli.md`.

## High-Value Commands

```bash
seal-home approval-runs pick --sn <sourceDocumentSN> --latest
seal-home approval-runs pick --sn <sourceDocumentSN> --batch <batchId> --latest --fields recordId,status,aiDecision,aiSummary
seal-home approval-runs get <recordId> --summary
seal-home approval-runs get <recordId> --fields metadata,document.fields,result.summary
seal-home approval-runs document-summary <recordId>
seal-home approval-runs cited-rules <recordId>
seal-home approval-runs attachments <recordId> --summary
seal-home approval-runs attachment-dispute --sn <sourceDocumentSN> --keywords 投标保证金,响应保证金,押金,比选保证金
seal-home approval-runs result <recordId> --summary
seal-home rules count --corp <corpId>
seal-home rules list --corp <corpId> --summary
seal-home rules get --version 16 --code '#0038'
seal-home rules get --record-id <recordId> --runtime-id rule-205
seal-home tool seal_approval_search --json '{"keywords":["差旅","发票"],"areas":["rules"],"snippetOnly":true,"maxChars":500,"fields":["id","title","snippet"]}'
```

## Important Fields

- `sourceDocumentSN`: external document number, often the easiest 合思/易快报 lookup key.
- `sourceDocumentId`: external source document ID.
- `recordId`: Seal approval run record ID.
- `simulationBatchId`: simulation batch identifier.
- `status`: run status.
- `taskMode` / `finalExecutionMode`: execution mode information.
- `ruleSetVersionNumber`: approval rule version used by a run.
- `langfuseTraceId`: direct Langfuse trace lookup key.
- `langfuseSessionFallback`: fallback session key, usually `hosecloud-{sourceDocumentSN}`.

## References

- `references/approval-run-lightweight.md`: 单号定位、字段裁剪、摘要、引用规则、单据摘要、附件摘要。
- `references/rule-lightweight.md`: 规则 count/list summary、按版本/编号取单条规则、规则搜索裁剪。
- `references/hose-enterprise-auth.md`: Hose 企业配置、认证诊断、授权链接。
- `references/approval-attachment-trace.md`: 附件/发票/OCR/图片争议的 Langfuse 追踪工作流。
- `references/cli.md`: 完整 CLI 命令清单。

## Safety

Rule, document, style preference, and publish actions mutate Seal configuration. Make the target enterprise explicit, show the intended payload, and verify after the write. Never send real `enterprises/*.json` files, tokens, signed URLs, or full raw documents to GitHub, tickets, logs, or chat unless the user explicitly requests a safe export.
