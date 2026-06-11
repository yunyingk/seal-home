import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { KyInstance } from "ky";
import {
  countKeywordMatches,
  diagnoseAttachmentDispute,
  extractTextFromDocxBuffer,
  findKeywordContexts
} from "./attachment-dispute.js";

describe("attachment dispute diagnostics", () => {
  test("counts keywords and truncates match context", () => {
    const text = [
      "供应商凭投标保证金收据原件及法定代表人授权委托书递交响应文件",
      `前置说明${"甲".repeat(120)}比选保证金：在递交响应文件截止时间前须交纳比选保证金6000元整${"乙".repeat(120)}`
    ].join("\n");

    expect(countKeywordMatches(text, ["投标保证金", "比选保证金", "押金"])).toEqual({
      投标保证金: 1,
      比选保证金: 2,
      押金: 0
    });

    const matches = findKeywordContexts(text, ["比选保证金"], {
      maxMatches: 1,
      contextChars: 8
    });
    expect(matches).toEqual([
      {
        keyword: "比选保证金",
        line: 2,
        context: expect.stringContaining("...") as unknown as string
      }
    ]);
    expect(matches[0]!.context.length).toBeLessThan(40);
  });

  test("extracts text from a minimal docx without textutil", () => {
    const buffer = makeDocxBuffer([
      "供应商凭投标保证金收据原件递交响应文件",
      "比选保证金：在递交响应文件截止时间前须交纳比选保证金6000元整"
    ]);

    const result = extractTextFromDocxBuffer(buffer);

    expect(result.extracted).toBe(true);
    expect(result.extractor).toBe("docx/unzip-xml");
    expect(result.text).toContain("投标保证金");
    expect(result.text).toContain("比选保证金");
  });

  test("diagnosis reports raw extraction errors per attachment", async () => {
    const result = await diagnoseAttachmentDispute(
      fakeClient(),
      {
        sn: "S26001948",
        keywords: ["投标保证金", "比选保证金"]
      }
    ) as {
      sourceDocumentSN: string;
      recordId: string;
      attachments: Array<{
        fileId?: string;
        rawText: { extracted: boolean; reason?: string };
      }>;
      conclusion: string;
    };

    expect(result.sourceDocumentSN).toBe("S26001948");
    expect(result.recordId).toBe("run-attachment-dispute");
    expect(result.attachments[0]).toMatchObject({
      fileId: "file-1",
      rawText: {
        extracted: false,
        reason: expect.stringContaining("attachment_download_failed")
      }
    });
    expect(JSON.stringify(result)).not.toContain("ossSignedUrl");
    expect(JSON.stringify(result)).not.toContain("http://127.0.0.1");
    expect(result.conclusion).toBe("raw_extraction_unavailable");
  });
});

function makeDocxBuffer(paragraphs: string[]) {
  const dir = mkdtempSync(join(tmpdir(), "seal-home-docx-test-"));
  try {
    const wordDir = join(dir, "word");
    mkdirSync(wordDir, { recursive: true });
    writeFileSync(
      join(wordDir, "document.xml"),
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    ${paragraphs.map((paragraph) => `<w:p><w:r><w:t>${escapeXml(paragraph)}</w:t></w:r></w:p>`).join("\n")}
  </w:body>
</w:document>`
    );
    writeFileSync(
      join(dir, "[Content_Types].xml"),
      `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"></Types>`
    );
    const zip = spawnSync("zip", ["-qr", "fixture.docx", "[Content_Types].xml", "word"], {
      cwd: dir
    });
    expect(zip.status).toBe(0);
    return readFileSync(join(dir, "fixture.docx"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function escapeXml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function fakeClient(): KyInstance {
  return {
    get: (url: string, options?: { searchParams?: URLSearchParams }) => ({
      json: async () => {
        if (url === "api/v1/approvals") {
          expect(options?.searchParams?.get("sourceDocumentSN")).toBe("S26001948");
          return {
            data: {
              records: [{
                id: "run-attachment-dispute",
                sourceDocumentSN: "S26001948",
                createdAt: "2026-06-10T10:00:00.000Z"
              }]
            }
          };
        }

        if (url === "api/v1/approvals/run-attachment-dispute") {
          return {
            data: {
              id: "run-attachment-dispute",
              sourceDocumentSN: "S26001948",
              sourceDocumentId: "source-doc-1",
              sourceExtendData: {
                _langfuseTraceId: "trace-1"
              },
              document: {
                fields: [{
                  label: "附件",
                  value: [{
                    fileId: "file-1",
                    name: "采购文件.docx",
                    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                    category: "attachment",
                    token: "sensitive-token",
                    ossSignedUrl: "http://127.0.0.1:1/secret.docx?token=abc"
                  }]
                }]
              },
              pipelineData: {
                document_parsing: "附件摘要未提及保证金"
              }
            }
          };
        }

        throw new Error(`unexpected url ${url}`);
      }
    })
  } as unknown as KyInstance;
}
