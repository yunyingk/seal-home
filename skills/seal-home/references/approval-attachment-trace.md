# Approval Attachment Trace Investigation

Use this workflow when a customer disputes an AI approval finding about an attachment, invoice, receipt, OCR result, or a UI-highlighted audit result.

The goal is to locate where an imprecise claim first entered the pipeline. Do not jump directly from the final approval result to a rule change. Many issues start earlier in the attachment understanding or attachment review stages.

## Mental Model

Approval traces commonly contain these stages:

1. Source document rendering
   - Seal converts the approval document into the Markdown-like "AI saw" document.
   - This may include both structured invoice fields and raw attachment fields.
2. Rule matching
   - Selects applicable rule scopes such as "存在发票或收据时" or "存在发票时".
   - This stage is not the final source of attachment type judgments; it works from the rendered document.
3. Image understanding
   - Vision model reads each image attachment and writes `document_content`.
   - This is often where loose labels such as "发票（或收据）", "定额发票", "销售单", or "支付凭证" first appear.
4. Pre-analysis
   - Generates `attachmentInstructions` and `reviewPoints` for later per-attachment review.
   - This stage can matter when a later attachment review seems to ignore or override values already present in the generated review points.
5. Document parsing / attachment review
   - A text model checks review points against the image-understanding text.
   - If the review point already says "该附件（定额发票）", it usually inherited that label from the previous stage instead of independently classifying the original image.
   - Check whether this stage uses values passed in the review point, or reclassifies the attachment and discards them.
6. Final approval review
   - Produces `rulesResult`, summaries, and UI findings.
   - Final findings can amplify earlier labels into business conclusions, for example "附件中存在定额发票未上传至发票栏位".

## Commands

Start from the Seal run and Langfuse trace.

```bash
seal-home approval-runs search --query <sourceDocumentSN> --limit 50
seal-home approval-runs get <recordId> > /tmp/seal-run.json
seal-home approval-runs bridge --sourceDocumentSN <sourceDocumentSN>
```

Refresh and inspect the Langfuse trace.

```bash
langfuse-home call langfuse_trace_cache_refresh --json '{"traceId":"<traceId>"}'
langfuse-home call langfuse_trace_url_get --json '{"traceId":"<traceId>"}'
langfuse-home call langfuse_trace_outline_get --json '{"traceId":"<traceId>","includeInput":true,"includeOutput":true,"maxPreviewChars":800}'
```

If `langfuse_trace_qrep_search` does not find Chinese terms reliably, grep the cached JSON directly.

```bash
rg -n "发票未上传至发票栏位|附件中存在定额发票|检查该附件（定额发票）|<file-name-or-fileId>" \
  .cache/langfuse/traces/default/<traceId>.json
```

Read focused IO for the relevant observations.

```bash
langfuse-home call langfuse_observation_io_get --json '{"traceId":"<traceId>","observationId":"<observationId>","maxChars":30000}'
```

## Separate Object IDs Before Judging

Never assume same-looking file names are the same object.

In Seal run detail, invoice-list entries and raw attachment entries can be separate objects:

- `invoiceForm` / `发票列表` entries often have source invoice IDs, invoice numbers, OCR-derived file names, `verifyResult`, `fileInfo.fileType=invoice`, and invoice metadata.
- `attachments` / `附件` entries often have UI file IDs such as `file-7`, Hose file IDs inside `token`, `category=file`, `mimeType=image/jpeg`, and their own OSS path.

Use `jq` to list them side by side.

```bash
jq -r '
  .document.fields[] | select(.key=="details") | .value[0][] | select(.key=="invoiceForm") | .value[] |
  ["invoiceForm", .sourceInvoiceId, .invoice.invoiceNumber, .invoice.fileInfo.fileName, .invoice.fileInfo.fileType, .invoice.fileInfo.ossPath, (.invoice.verifyResult.rawData | fromjson? | .form.sourceEntityId // "")] | @tsv
' /tmp/seal-run.json
```

```bash
jq -r '
  .document.fields[] | select(.key=="details") | .value[0][] | select(.key=="attachments") | .value[] |
  ["attachments", .fileId, .name, .category, .mimeType, .ossPath, .token] | @tsv
' /tmp/seal-run.json
```

When explaining the result, say precisely whether the disputed item is:

- a structured invoice-list object,
- a raw attachment object,
- or two distinct objects with similar file names/content.

## Find Where A Bad Label First Appeared

Search for the UI finding text and the disputed label.

```bash
jq -r '
  def walkobs(o): o, ((o.children // [])[] | walkobs(.));
  .trace.observations[] | walkobs(.)
  | select(((.input|tostring)+"\n"+(.output|tostring))
      | contains("发票未上传至发票栏位")
        or contains("附件中存在定额发票")
        or contains("检查该附件（定额发票）"))
  | [.id,.name,.type,.startTime,((.output|tostring)|gsub("\n";" ")|.[0:500])] | @tsv
' .cache/langfuse/traces/default/<traceId>.json
```

Then inspect the earliest matching observation. Typical interpretation:

- `image_understanding:ai.streamText`: the vision stage first assigned the type label.
- `pre_analysis:ai.streamText`: the instruction-generation stage turned matched rules and parsed attachments into per-file `reviewPoints`; this is where attachment-side values or labels can be copied into prompts.
- `document_parsing:ai.streamText`: the attachment review inherited the label in its review point or document content.
- `approval_review:ai.streamText`: the final model converted inherited labels into a rule finding.

## Check Pre-Analysis For Amount-Total Disputes

When the customer says the AI "did not recognize the correct amount", "missed one payment screenshot", or "the total should be X", start with the normal trace: source document, image understanding, attachment review, and final review. Inspect `pre_analysis` when the evidence suggests the disputed amount was recognized earlier but later ignored, or when final review is aggregating inconsistent per-attachment conclusions. Treat this as a possible failure mode, not as the default cause.

Find the node:

```bash
jq -r '
  def walkobs(x; depth): (x + {depth: depth}), ((x.children? // [])[] | walkobs(.; depth+1));
  .trace.observations[] | walkobs(.; 0)
  | select(.name? | test("pre_analysis"))
  | [.startTime,.id,.name,.type,.parentObservationId,((.input|tostring|length)//0),((.output|tostring|length)//0)] | @tsv
' .cache/langfuse/traces/default/<traceId>.json
```

Then inspect its output for the disputed file and rule:

```bash
jq -r '
  def walkobs(x): x, ((x.children? // [])[] | walkobs(.));
  .trace.observations[] | walkobs(.)
  | select(.name? == "pre_analysis:ai.streamText")
  | .output
' .cache/langfuse/traces/default/<traceId>.json | rg -n "fileId|fileName|<file-name>|付款截图金额|收款金额|金额合计"
```

Look for these failure patterns:

- A global aggregate requirement was split into per-attachment review points, for example each attachment is asked whether its amount plus "other attachments" reaches the reimbursement amount.
- The pre-analysis prompt says not to write attachment OCR/image-understanding candidate values into review points, but the output still includes values such as "付款截图金额（1850.00元）" or labels such as "收款凭证".
- The same physical image appears twice because it exists under both form-level attachments and fee-detail attachments, producing duplicate `fileId`s and potentially inconsistent later judgments.
- `pre_analysis` passes a value down, but `document_parsing` reclassifies the file and ignores that value, for example a review point says "付款截图金额（1850.00元）" while the parser answer says "收款凭证，非付款截图".

For these cases, the amount may not be lost in OCR or image understanding. It may be lost when a later attachment-review node overrides the pre-analysis task premise, or when final approval review aggregates inconsistent per-file conclusions. For concrete examples, see `approval-bad-cases.md`.

## Check Images When The Dispute Is Visual

If the issue depends on whether an image is a receipt or invoice, inspect the raw image. Do not rely only on the model's textual description.

Extract raw attachment signed URLs from `/tmp/seal-run.json` and download the disputed files.

```bash
jq -r '
  .document.fields[] | select(.key=="details") | .value[0][] | select(.key=="attachments") | .value[] |
  select(.fileId=="file-7" or .fileId=="file-9") |
  [.fileId,.name,.ossSignedUrl] | @tsv
' /tmp/seal-run.json
```

Look for invoice-specific elements:

- "发票" text in the title
- invoice code / invoice number
- tax bureau supervision seal
- tax invoice QR/code metadata
- buyer/seller tax information
- taxable amount / tax rate / tax amount fields

If those are absent and the document is a store-stamped handwritten slip, it is safer to call it a receipt or sales voucher, not a formal invoice.

## Reporting Pattern

When answering the user, separate:

- What the final UI finding says.
- The first pipeline stage where the disputed claim appeared.
- Whether the disputed file is a raw attachment or a structured invoice-list object.
- Whether the raw image supports the claim.
- Whether the final decision still stands for other independent reasons.

Example wording:

```text
The UI finding was produced in final approval review, but the imprecise label started earlier:
image_understanding labeled file-9 as "定额发票"; document_parsing then inherited that as "该附件（定额发票）"; approval_review converted it into the rule-3 finding.

The raw attachment object itself is not structurally marked as invoice; it is category=file, mimeType=image/jpeg. The image lacks formal invoice elements, so the customer's receipt interpretation is reasonable.
```

## Case Note: Receipt-Like Attachments Labeled As Invoices

This case involved a UI finding:

```text
发票未上传至发票栏位：附件中存在定额发票（金额160元、90元），但未上传至发票栏位。
```

Important correction:

- `file-7` and `file-9` were raw attachment objects, not the same objects as the invoice-list entries.
- The invoice list had separate IDs (`ID01P95oy1RWbB`, `ID01P95oy22hnV`).
- The raw attachments had separate file IDs (`file-7` / Hose `ID01P95CwuNGLJ`, and `file-9` / Hose `ID01P95RUC9T79`).

Root of imprecision:

- `file-7` was first described by `image_understanding` as "发票（或收据）", then later attachment review used "定额发票".
- `file-9` was directly described by `image_understanding` as "定额发票".
- Final `approval_review` turned those inherited labels into the rule-3 UI warning.

Manual image check:

- The 160 and 90 slips looked like store-stamped handwritten receipts/sales vouchers.
- They lacked obvious formal invoice elements.
- The customer's objection that they were receipts rather than invoices was reasonable.

However, the final rejection also had an independent rule-37 reason: payment screenshots totaled 699.48 while reimbursement was 700.00.
