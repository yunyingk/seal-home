import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { inflateRawSync } from "node:zlib";
import { KyInstance } from "ky";
import * as api from "./api.js";
import type { ApprovalRun } from "./types.js";

const DEFAULT_MAX_MATCHES = 20;
const DEFAULT_CONTEXT_CHARS = 80;
const MAX_DOWNLOAD_BYTES = 50 * 1024 * 1024;

export type AttachmentDisputeParams = {
  sn?: string;
  recordId?: string;
  latest?: boolean;
  keywords: string[] | string;
};

type AttachmentObject = {
  path: string;
  fileId?: string;
  name?: string;
  mimeType?: string;
  category?: string;
  token?: string;
  ossSignedUrl: string;
};

type TextExtractionResult = {
  extracted: boolean;
  extractor?: string;
  text?: string;
  reason?: string;
};

export async function diagnoseAttachmentDispute(
  client: KyInstance,
  params: AttachmentDisputeParams
) {
  const keywords = parseKeywords(params.keywords);
  if (keywords.length === 0) throw new Error("--keywords is required");
  if (!params.recordId && !params.sn) throw new Error("Pass --sn <sourceDocumentSN> or --record-id <recordId>");

  const record = await resolveRun(client, params);
  const traceId = stringFromUnknown(record.sourceExtendData?._langfuseTraceId);
  const attachments = extractSignedUrlAttachments(record);
  const checkedAttachments = await Promise.all(
    attachments.map((attachment) => inspectAttachmentSafely(attachment, keywords))
  );
  const pipeline = buildPipelineKeywordCheck(record, keywords, traceId);

  return compactObject({
    sourceDocumentSN: record.sourceDocumentSN ?? params.sn,
    recordId: record.id,
    traceId,
    sourceDocumentId: record.sourceDocumentId,
    keywords,
    attachmentCount: attachments.length,
    attachments: checkedAttachments.map((attachment) => ({
      ...attachment,
      pipeline
    })),
    conclusion: conclude(checkedAttachments, pipeline),
    skipped: attachments.length === 0
      ? [{ reason: "no_attachment_with_ossSignedUrl" }]
      : undefined
  });
}

export function parseKeywords(value: string[] | string): string[] {
  const items = Array.isArray(value) ? value : value.split(",");
  return Array.from(new Set(items.map((item) => item.trim()).filter(Boolean)));
}

export function countKeywordMatches(text: string, keywords: string[]) {
  return Object.fromEntries(
    keywords.map((keyword) => [keyword, countOccurrences(text, keyword)])
  );
}

export function findKeywordContexts(
  text: string,
  keywords: string[],
  options: { maxMatches?: number; contextChars?: number } = {}
) {
  const maxMatches = options.maxMatches ?? DEFAULT_MAX_MATCHES;
  const contextChars = options.contextChars ?? DEFAULT_CONTEXT_CHARS;
  const matches: Array<{ keyword: string; line: number; context: string }> = [];
  const lines = text.split(/\r?\n/);

  lines.forEach((line, index) => {
    for (const keyword of keywords) {
      if (!line.includes(keyword)) continue;
      matches.push({
        keyword,
        line: index + 1,
        context: clipAroundKeyword(normalizeWhitespace(line), keyword, contextChars)
      });
      if (matches.length >= maxMatches) return;
    }
  });

  return matches.slice(0, maxMatches);
}

export function extractTextFromDocxBuffer(buffer: Buffer): TextExtractionResult {
  const entries = unzipDocxEntries(buffer, /^word\/(document|header\d+|footer\d+|footnotes|endnotes)\.xml$/);
  if (entries.length === 0) {
    return { extracted: false, reason: "docx_xml_entries_not_found" };
  }

  const text = entries
    .map((entry) => docxXmlToText(entry.content))
    .filter(Boolean)
    .join("\n")
    .trim();

  return text
    ? { extracted: true, extractor: "docx/unzip-xml", text }
    : { extracted: false, reason: "docx_text_empty" };
}

function extractSignedUrlAttachments(record: ApprovalRun): AttachmentObject[] {
  const roots: Array<[string, unknown]> = [
    ["document", record.document],
    ["result", record.result],
    ["pipelineData", record.pipelineData],
    ["sourceExtendData", record.sourceExtendData]
  ];
  const attachments: AttachmentObject[] = [];
  const seen = new Set<string>();

  for (const [path, value] of roots) {
    collectSignedUrlAttachments(value, path, attachments, seen);
  }

  return attachments;
}

function collectSignedUrlAttachments(
  value: unknown,
  path: string,
  output: AttachmentObject[],
  seen: Set<string>
) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectSignedUrlAttachments(item, `${path}.${index}`, output, seen));
    return;
  }

  const object = asRecord(value);
  if (!object) return;

  const ossSignedUrl = stringFromUnknown(object.ossSignedUrl);
  if (ossSignedUrl) {
    const attachment = compactObject({
      path,
      fileId: stringFromUnknown(object.fileId) ?? stringFromUnknown(object.id) ?? stringFromUnknown(object.attachmentId),
      name: stringFromUnknown(object.name) ?? stringFromUnknown(object.fileName) ?? stringFromUnknown(object.filename) ?? stringFromUnknown(object.originalName),
      mimeType: stringFromUnknown(object.mimeType) ?? stringFromUnknown(object.mimetype) ?? stringFromUnknown(object.contentType),
      category: stringFromUnknown(object.category) ?? stringFromUnknown(object.type),
      token: stringFromUnknown(object.token) ? "<redacted>" : undefined,
      ossSignedUrl
    }) as AttachmentObject;
    const key = attachment.fileId ?? attachment.name ?? attachment.ossSignedUrl;
    if (!seen.has(key)) {
      seen.add(key);
      output.push(attachment);
    }
  }

  for (const [key, child] of Object.entries(object)) {
    collectSignedUrlAttachments(child, `${path}.${key}`, output, seen);
  }
}

async function inspectAttachment(attachment: AttachmentObject, keywords: string[]) {
  const publicAttachment = compactObject({
    fileId: attachment.fileId,
    name: attachment.name,
    mimeType: attachment.mimeType,
    category: attachment.category,
    token: attachment.token
  });

  const rawText = await extractRawAttachmentText(attachment);
  if (!rawText.extracted || rawText.text === undefined) {
    return {
      ...publicAttachment,
      rawText: compactObject({
        extracted: false,
        reason: rawText.reason,
        extractor: rawText.extractor,
        keywordCounts: Object.fromEntries(keywords.map((keyword) => [keyword, 0])),
        matches: []
      })
    };
  }

  return {
    ...publicAttachment,
    rawText: {
      extracted: true,
      extractor: rawText.extractor,
      textLength: rawText.text.length,
      keywordCounts: countKeywordMatches(rawText.text, keywords),
      matches: findKeywordContexts(rawText.text, keywords)
    }
  };
}

async function inspectAttachmentSafely(attachment: AttachmentObject, keywords: string[]) {
  try {
    return await inspectAttachment(attachment, keywords);
  } catch (error) {
    return {
      fileId: attachment.fileId,
      name: attachment.name,
      mimeType: attachment.mimeType,
      category: attachment.category,
      token: attachment.token,
      rawText: {
        extracted: false,
        reason: redactErrorReason(error instanceof Error ? error.message : String(error)),
        keywordCounts: Object.fromEntries(keywords.map((keyword) => [keyword, 0])),
        matches: []
      }
    };
  }
}

async function extractRawAttachmentText(attachment: AttachmentObject): Promise<TextExtractionResult> {
  const kind = inferFileKind(attachment);
  if (!kind.supported) return { extracted: false, reason: kind.reason };

  const buffer = await downloadAttachment(attachment.ossSignedUrl);
  if (kind.kind === "docx") return extractTextFromDocxBuffer(buffer);
  if (kind.kind === "text") {
    return { extracted: true, extractor: "text/utf8", text: buffer.toString("utf-8") };
  }
  if (kind.kind === "html") {
    return { extracted: true, extractor: "html/plain-text", text: htmlToText(buffer.toString("utf-8")) };
  }
  if (kind.kind === "pdf") return extractPdfText(buffer);
  if (kind.kind === "xlsx") return { extracted: false, reason: "xlsx_text_extraction_not_available" };

  return { extracted: false, reason: "unsupported_file_type" };
}

async function downloadAttachment(url: string): Promise<Buffer> {
  const response = await fetch(url).catch((error) => {
    throw new Error(`attachment_download_failed:${error instanceof Error ? error.message : String(error)}`);
  });
  if (!response.ok) {
    throw new Error(`attachment_download_failed:${response.status}`);
  }
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_DOWNLOAD_BYTES) {
    throw new Error(`attachment_too_large:${contentLength}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

async function extractPdfText(buffer: Buffer): Promise<TextExtractionResult> {
  const pdftotext = commandPath("pdftotext");
  const mutool = commandPath("mutool");
  if (!pdftotext && !mutool) {
    return { extracted: false, reason: "pdf_text_extractor_not_available" };
  }

  const dir = await mkdtemp(join(tmpdir(), "seal-home-attachment-"));
  try {
    const file = join(dir, "attachment.pdf");
    await writeFile(file, buffer);
    const result = pdftotext
      ? spawnSync(pdftotext, ["-layout", file, "-"], { encoding: "utf-8", maxBuffer: 20 * 1024 * 1024 })
      : spawnSync(mutool!, ["draw", "-F", "txt", "-o", "-", file], { encoding: "utf-8", maxBuffer: 20 * 1024 * 1024 });

    if (result.status !== 0) {
      return { extracted: false, extractor: pdftotext ? "pdftotext" : "mutool", reason: "pdf_text_extraction_failed" };
    }

    const text = result.stdout.trim();
    return text
      ? { extracted: true, extractor: pdftotext ? "pdftotext" : "mutool", text }
      : { extracted: false, extractor: pdftotext ? "pdftotext" : "mutool", reason: "pdf_text_empty_or_scanned" };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function inferFileKind(attachment: AttachmentObject):
  | { supported: true; kind: "docx" | "pdf" | "text" | "html" | "xlsx" }
  | { supported: false; reason: string } {
  const name = attachment.name ?? "";
  const ext = extname(name).toLowerCase();
  const mimeType = (attachment.mimeType ?? "").toLowerCase();

  if (mimeType.includes("wordprocessingml.document") || ext === ".docx") return { supported: true, kind: "docx" };
  if (mimeType === "application/pdf" || ext === ".pdf") return { supported: true, kind: "pdf" };
  if (mimeType.includes("spreadsheetml.sheet") || ext === ".xlsx") return { supported: true, kind: "xlsx" };
  if (mimeType.includes("html") || [".html", ".htm"].includes(ext)) return { supported: true, kind: "html" };
  if (
    mimeType.startsWith("text/") ||
    ["text/csv", "application/json", "application/xml"].includes(mimeType) ||
    [".txt", ".csv", ".md", ".json", ".xml"].includes(ext)
  ) return { supported: true, kind: "text" };

  return { supported: false, reason: `unsupported_file_type:${mimeType || ext || "unknown"}` };
}

function buildPipelineKeywordCheck(record: ApprovalRun, keywords: string[], traceId?: string) {
  const checks = {
    parsedAttachmentContainsKeyword: containsKeywordAtPaths(record, keywords, [
      "pipelineData.parsedAttachments",
      "pipelineData.parsed_attachments",
      "pipelineData.attachmentText",
      "pipelineData.attachments"
    ]),
    documentParsingInputContainsKeyword: containsKeywordAtPaths(record, keywords, [
      "pipelineData.document_parsing",
      "pipelineData.documentParsing",
      "pipelineData.documentContent",
      "pipelineData.document_content"
    ]),
    approvalReviewInputContainsKeyword: containsKeywordAtPaths(record, keywords, [
      "pipelineData.approval_review",
      "pipelineData.approvalReview",
      "result"
    ])
  };

  return {
    checked: true,
    source: "run_json_best_effort",
    traceChecked: false,
    traceReason: traceId ? "langfuse_home_not_invoked_by_cli_helper" : "traceId_absent",
    ...checks,
    likelyLossStage: inferLossStage(checks)
  };
}

function containsKeywordAtPaths(record: ApprovalRun, keywords: string[], paths: string[]) {
  return paths.some((path) => {
    const value = getPath(record, path);
    return value !== undefined && keywords.some((keyword) => safeStringify(value).includes(keyword));
  });
}

function inferLossStage(checks: {
  parsedAttachmentContainsKeyword: boolean;
  documentParsingInputContainsKeyword: boolean;
  approvalReviewInputContainsKeyword: boolean;
}) {
  if (!checks.parsedAttachmentContainsKeyword) return "attachment_extraction_or_summary";
  if (!checks.documentParsingInputContainsKeyword) return "pre_analysis_to_document_parsing";
  if (!checks.approvalReviewInputContainsKeyword) return "document_parsing_to_approval_review";
  return undefined;
}

function conclude(
  attachments: Array<{ rawText?: { extracted?: boolean; keywordCounts?: Record<string, number> } }>,
  pipeline: { parsedAttachmentContainsKeyword: boolean; documentParsingInputContainsKeyword: boolean; approvalReviewInputContainsKeyword: boolean }
) {
  const extracted = attachments.some((attachment) => attachment.rawText?.extracted);
  const rawContains = attachments.some((attachment) =>
    Object.values(attachment.rawText?.keywordCounts ?? {}).some((count) => count > 0)
  );

  if (!extracted) return "raw_extraction_unavailable";
  if (!rawContains) return "no_raw_keyword_match";
  if (!pipeline.parsedAttachmentContainsKeyword || !pipeline.documentParsingInputContainsKeyword) {
    return "raw_attachment_contains_keywords_but_pipeline_omitted_them";
  }
  if (pipeline.approvalReviewInputContainsKeyword) return "pipeline_contains_keywords_but_final_rejected";
  return "raw_attachment_contains_keywords";
}

async function resolveRun(client: KyInstance, params: AttachmentDisputeParams): Promise<ApprovalRun> {
  if (params.recordId) return api.getApprovalRun(client, params.recordId);

  const data = await api.listApprovalRuns(client, {
    limit: 20,
    search: params.sn,
    sourceDocumentSN: params.sn
  });
  const records = data.records
    .filter((record) => record.sourceDocumentSN === params.sn)
    .sort((left, right) => timestampOf(right.createdAt) - timestampOf(left.createdAt));
  const record = records[0];
  if (!record) throw new Error(`Approval run not found for sourceDocumentSN ${params.sn}`);
  return api.getApprovalRun(client, record.id);
}

function unzipDocxEntries(buffer: Buffer, pattern: RegExp) {
  const entries = readZipEntries(buffer);
  return entries
    .filter((entry) => pattern.test(entry.name))
    .map((entry) => ({
      name: entry.name,
      content: entry.data.toString("utf-8")
    }));
}

function readZipEntries(buffer: Buffer) {
  const eocdOffset = findEndOfCentralDirectory(buffer);
  if (eocdOffset < 0) return [];
  const totalEntries = buffer.readUInt16LE(eocdOffset + 10);
  const centralDirectoryOffset = buffer.readUInt32LE(eocdOffset + 16);
  const entries: Array<{ name: string; data: Buffer }> = [];
  let offset = centralDirectoryOffset;

  for (let index = 0; index < totalEntries; index += 1) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) break;
    const compressionMethod = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const uncompressedSize = buffer.readUInt32LE(offset + 24);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localHeaderOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.subarray(offset + 46, offset + 46 + nameLength).toString("utf-8");

    const localNameLength = buffer.readUInt16LE(localHeaderOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localHeaderOffset + 28);
    const dataOffset = localHeaderOffset + 30 + localNameLength + localExtraLength;
    const compressed = buffer.subarray(dataOffset, dataOffset + compressedSize);
    const data = compressionMethod === 0
      ? compressed
      : compressionMethod === 8
        ? inflateRawSync(compressed, { finishFlush: 2 })
        : undefined;
    if (data && (uncompressedSize === 0 || data.length === uncompressedSize)) {
      entries.push({ name, data });
    }

    offset += 46 + nameLength + extraLength + commentLength;
  }

  return entries;
}

function findEndOfCentralDirectory(buffer: Buffer) {
  const minOffset = Math.max(0, buffer.length - 65557);
  for (let offset = buffer.length - 22; offset >= minOffset; offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) return offset;
  }
  return -1;
}

function docxXmlToText(xml: string): string {
  return xml
    .replace(/<w:tab\b[^>]*\/>/g, "\t")
    .replace(/<w:br\b[^>]*\/>/g, "\n")
    .replace(/<\/w:p>/g, "\n")
    .replace(/<\/w:tr>/g, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'")
    .split(/\r?\n/)
    .map((line) => normalizeWhitespace(line))
    .filter(Boolean)
    .join("\n");
}

function htmlToText(html: string): string {
  return html
    .replace(/<script\b[\s\S]*?<\/script>/gi, "")
    .replace(/<style\b[\s\S]*?<\/style>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .split(/\r?\n/)
    .map((line) => normalizeWhitespace(line))
    .filter(Boolean)
    .join("\n");
}

function countOccurrences(text: string, keyword: string) {
  if (!keyword) return 0;
  let count = 0;
  let index = 0;
  while (true) {
    const hit = text.indexOf(keyword, index);
    if (hit < 0) return count;
    count += 1;
    index = hit + keyword.length;
  }
}

function clipAroundKeyword(line: string, keyword: string, contextChars: number) {
  const index = line.indexOf(keyword);
  if (index < 0 || line.length <= contextChars * 2 + keyword.length) return line;
  const start = Math.max(0, index - contextChars);
  const end = Math.min(line.length, index + keyword.length + contextChars);
  return `${start > 0 ? "..." : ""}${line.slice(start, end)}${end < line.length ? "..." : ""}`;
}

function normalizeWhitespace(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function commandPath(command: string) {
  const result = spawnSync("sh", ["-lc", `command -v ${command}`], { encoding: "utf-8" });
  const value = result.stdout.trim();
  return result.status === 0 && value ? value : undefined;
}

function getPath(value: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((current, segment) => {
    if (current === undefined || current === null) return undefined;
    if (Array.isArray(current)) {
      const index = Number(segment);
      return Number.isInteger(index) ? current[index] : undefined;
    }
    if (typeof current === "object") return (current as Record<string, unknown>)[segment];
    return undefined;
  }, value);
}

function safeStringify(value: unknown) {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function timestampOf(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function stringFromUnknown(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function compactObject<T extends Record<string, unknown>>(object: T): T {
  return Object.fromEntries(Object.entries(object).filter(([, value]) => value !== undefined)) as T;
}

function redactErrorReason(value: string) {
  return value
    .replace(/https?:\/\/\S+/g, "<redacted-url>")
    .replace(/([?&](?:accessToken|token|signature|OSSAccessKeyId|Expires|SecurityToken)=)[^&\s]+/gi, "$1<redacted>");
}
