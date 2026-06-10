# Approval Bad Case Catalog

Use this file only as a comparison catalog after inspecting the current trace. Do not treat any case below as a default diagnosis.

## Case A: Receipt-Like Attachments Labeled As Invoices

Symptom:

- UI finding said attachments contained fixed-amount invoices that were not uploaded to the invoice field.
- Customer said the 160 and 90 slips were receipts, not invoices.

Failure pattern:

- Raw attachment objects and invoice-list objects had similar names/content but different IDs.
- `image_understanding` first introduced loose or wrong labels such as "发票（或收据）" and "定额发票".
- `document_parsing` inherited those labels.
- `approval_review` converted the inherited labels into a rule finding.

Checklist:

- Compare raw attachment IDs and invoice-list IDs before making a claim.
- Inspect the original image for formal invoice elements.
- If the image lacks invoice title, tax supervision seal, invoice code/number, and tax fields, the customer's receipt interpretation may be reasonable.

## Case B: Payment Amount Passed Earlier, Then Excluded Later

Symptom:

- UI finding said payment screenshots totaled only 1550 (`650+900`) against reimbursement amount 3400.
- Customer said the 1850 screenshot was also a payment-support screenshot and should have been included.

Failure pattern:

- The same six images appeared twice: under fee-detail attachments (`file-1` to `file-6`) and form-level attachments (`file-7` to `file-12`).
- `image_understanding` did not lose the 1850 amount; it extracted `1850.00`.
- `pre_analysis` explicitly passed 1850 as a payment-screenshot amount candidate in a review point: "付款截图金额（1850.00元）".
- `document_parsing` later reclassified `1850.jpg` as "收款凭证，非付款截图", overriding the review-point premise.
- Duplicate `900.jpg` entries produced inconsistent parser conclusions; final review included 900 but excluded 1850.

Checklist:

- If an amount is missing from the final total, check whether it was recognized in `image_understanding`.
- If recognized, check whether `pre_analysis` passed it in `attachmentInstructions.reviewPoints`.
- If passed, check whether `document_parsing` ignored or reclassified it.
- If the same image appears under multiple `fileId`s, compare duplicate conclusions before trusting final aggregation.

Important nuance:

- This is a bad-case pattern, not a general rule that every amount-total dispute is caused by `pre_analysis`.
- Use it when the current trace shows recognized amounts being excluded downstream or duplicate attachments producing inconsistent conclusions.
