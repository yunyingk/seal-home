# Approval Run Lightweight Queries

Use this reference when the user gives a 合思/易快报单号, source document SN, record ID, simulation batch ID, or asks for an approval decision without needing the full raw run payload.

## Locate A Run By Document Number

Prefer `pick` before broad search + bridge + get.

```bash
seal-home approval-runs pick --corp <corpId> --sn <sourceDocumentSN> --latest
seal-home approval-runs pick --corp <corpId> --sn <sourceDocumentSN> --batch <batchId> --latest
seal-home approval-runs pick --corp <corpId> --sn <sourceDocumentSN> --latest --fields recordId,sourceDocumentSN,status,aiDecision,aiSummary
```

Default output is intentionally small: `recordId`, `sourceDocumentSN`, `sourceDocumentId`, `simulationBatchId`, `status`, `taskMode`, `ruleSetVersionNumber`, `langfuseTraceId`, `manualResult`, `aiDecision`, and `aiSummary`.

If there are multiple candidates and `--latest` was not used, report the candidates and ask which one to inspect.

## Read Compact Run Detail

Use `--summary` for most diagnosis and support questions.

```bash
seal-home approval-runs get <recordId> --summary
```

Use `--fields` when the user needs a particular slice.

```bash
seal-home approval-runs get <recordId> --fields metadata
seal-home approval-runs get <recordId> --fields document.fields,result.summary
seal-home approval-runs get <recordId> --fields result.summary,result.decision,result.riskPoints
seal-home approval-runs get <recordId> --fields document.keyFields,result,manualApprovalRecord,ruleSetVersionNumber
```

Avoid full `approval-runs get <recordId>` unless the user specifically needs raw document fields, pipeline logs, invoice rawData, or signed URLs. Prefer `--output-file` for full payloads.

## Understand The Case First

Before pulling the full document, use:

```bash
seal-home approval-runs document-summary <recordId>
```

This is for quick case reading: template/title, key fields, amount, expense type, cost company, payee, invoice summary, attachment names, AI result, and manual result.

## Extract AI-Cited Rules

Use this when the user asks "AI 用了哪条规则", "为什么命中这条", or needs the rule evidence for a specific run.

```bash
seal-home approval-runs cited-rules <recordId>
```

Return and discuss `runtimeRuleId`, `ruleCode`, `versionNumber`, `scope`, `strictness`, `appliedAnalysis`, `checkResult`, and `findings` when present.

If the user then wants the full text of one cited rule, use `rules get --record-id <recordId> --runtime-id rule-205` from `rule-lightweight.md`.

## Attachments Without Raw Payloads

Use:

```bash
seal-home approval-runs attachments <recordId> --summary
```

This should be enough for file names, file IDs, mime types, positions, invoice/attachment grouping, and links when available. For customer disputes about OCR, receipt/invoice classification, or image content, switch to `approval-attachment-trace.md`.

## Result Summary

Use:

```bash
seal-home approval-runs result <recordId> --summary
```

This is for decision, summary, risk point count, matched rule count, trace ID, and record ID.

## Output Discipline

If a command warns that output is large, do not retry with `--full` reflexively. Narrow with `--summary`, `--fields`, or `--output-file` first.
