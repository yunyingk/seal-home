import { z } from "zod";
import { KyInstance } from "ky";
import * as api from "./api.js";
import { getHoseEnterpriseUrl } from "../../core/auth/hose.js";
import { CorpConfig } from "../../core/config/types.js";
import { searchApprovalContent } from "./search.js";
import type { ApprovalRule, ApprovalRun, RuleSetVersion } from "./types.js";

type ToolContext = {
  corp: CorpConfig;
};

type SealToolDefinition = {
  name: string;
  description: string;
  parameters: z.ZodType;
  handler: (client: KyInstance, params: never, context: ToolContext) => Promise<unknown>;
};

export const sealTools = [
  {
    name: "seal_whoami",
    description: "查询当前 Seal 用户身份及租户信息",
    parameters: z.object({}),
    handler: async (client: KyInstance) => api.getMe(client)
  },
  {
    name: "seal_session_get",
    description: "查询当前 Seal Bearer session、用户和过期时间",
    parameters: z.object({}),
    handler: async (client: KyInstance) => api.getSession(client)
  },
  {
    name: "seal_approval_rules_list",
    description: "列出 Seal 当前草稿审批规则；支持 countOnly、fields、limit 以避免返回规则正文",
    parameters: z.object({
      countOnly: z.boolean().optional().describe("只返回规则数量，不返回规则列表"),
      fields: z.array(z.enum([
        "id",
        "tenantId",
        "status",
        "strictness",
        "scope",
        "createdAt",
        "updatedAt",
        "description"
      ])).optional().describe("只返回指定字段；不传则返回完整规则"),
      limit: z.number().int().nonnegative().optional().describe("最多返回多少条规则；0 可配合 fields 或 countOnly 只取数量"),
      offset: z.number().int().nonnegative().optional().describe("跳过前多少条规则")
    }),
    handler: async (
      client: KyInstance,
      params: {
        countOnly?: boolean;
        fields?: RuleField[];
        limit?: number;
        offset?: number;
      }
    ) => {
      const data = await api.listApprovalRules(client);
      return projectApprovalRules(data, params);
    }
  },
  {
    name: "seal_approval_rule_create",
    description: "新建 Seal 草稿审批规则",
    parameters: z.object({
      description: z.string().describe("规则描述"),
      scope: z.string().describe("适用场景"),
      strictness: z.enum(["MUST_FOLLOW", "SHOULD_FOLLOW", "SUGGESTION"]).describe("严格程度")
    }),
    handler: async (
      client: KyInstance,
      params: { description: string; scope: string; strictness: string }
    ) => api.createApprovalRule(client, params)
  },
  {
    name: "seal_approval_rule_update",
    description: "更新 Seal 草稿审批规则",
    parameters: z.object({
      ruleId: z.string().describe("规则 ID"),
      description: z.string().optional(),
      scope: z.string().optional(),
      strictness: z.enum(["MUST_FOLLOW", "SHOULD_FOLLOW", "SUGGESTION"]).optional()
    }),
    handler: async (
      client: KyInstance,
      params: { ruleId: string; description?: string; scope?: string; strictness?: string }
    ) => {
      const { ruleId, ...rest } = params;
      return api.updateApprovalRule(client, ruleId, rest);
    }
  },
  {
    name: "seal_approval_rule_delete",
    description: "删除 Seal 草稿审批规则",
    parameters: z.object({
      ruleId: z.string().describe("规则 ID")
    }),
    handler: async (client: KyInstance, params: { ruleId: string }) => {
      await api.deleteApprovalRule(client, params.ruleId);
      return { success: true };
    }
  },
  {
    name: "seal_approval_rule_versions_list",
    description: "列出 Seal 已发布审批规则版本摘要，不展开每个版本的规则快照",
    parameters: z.object({}),
    handler: async (client: KyInstance) => {
      const versions = await api.listApprovalRuleVersions(client);
      return {
        count: versions.length,
        latest: versions[0] ? summarizeRuleVersion(versions[0]) : undefined,
        versions: versions.map(summarizeRuleVersion)
      };
    }
  },
  {
    name: "seal_approval_rule_version_get",
    description: "获取指定 Seal 已发布审批规则版本详情，包含该版本的规则快照",
    parameters: z.object({
      versionId: z.string().optional().describe("规则版本 ID"),
      versionNumber: z.number().int().positive().optional().describe("规则版本号"),
      latest: z.boolean().optional().describe("为 true 时获取最新版本")
    }),
    handler: async (
      client: KyInstance,
      params: { versionId?: string; versionNumber?: number; latest?: boolean }
    ) => {
      if (params.versionId) return api.getApprovalRuleVersion(client, params.versionId);

      const versions = await api.listApprovalRuleVersions(client);
      const version = params.versionNumber
        ? versions.find((item) => item.versionNumber === params.versionNumber)
        : versions[0];

      if (!version) {
        throw new Error(params.versionNumber
          ? `Rule version not found: ${params.versionNumber}`
          : "No rule versions found");
      }

      return version;
    }
  },
  {
    name: "seal_approval_rule_version_publish",
    description: "发布 Seal 草稿审批规则为新版本",
    parameters: z.object({
      versionName: z.string().describe("版本名称")
    }),
    handler: async (client: KyInstance, params: { versionName: string }) =>
      api.publishApprovalRuleVersion(client, params.versionName)
  },
  {
    name: "seal_approval_rule_get",
    description: "按版本号/code/runtime-id/record-id 定位单条规则，避免拉取整版规则快照",
    parameters: z.object({
      versionId: z.string().optional().describe("规则版本 ID"),
      versionNumber: z.number().int().positive().optional().describe("规则版本号"),
      latest: z.boolean().optional().describe("为 true 时取最新版本"),
      code: z.string().optional().describe("规则展示编号，如 #0038；没有后端 code 时按版本内序号匹配"),
      runtimeId: z.string().optional().describe("运行时规则 ID，如 rule-205；按版本内序号匹配"),
      recordId: z.string().optional().describe("从运行记录推断 ruleSetVersionNumber")
    }),
    handler: async (
      client: KyInstance,
      params: {
        versionId?: string;
        versionNumber?: number;
        latest?: boolean;
        code?: string;
        runtimeId?: string;
        recordId?: string;
      }
    ) => {
      const version = await resolveRuleVersionForLookup(client, params);
      const rule = findRuleInVersion(version, {
        code: params.code,
        runtimeId: params.runtimeId
      });
      if (!rule) {
        throw new Error(`Rule not found in version ${version.versionNumber}`);
      }
      return rule;
    }
  },
  {
    name: "seal_approval_documents_list",
    description: "列出 Seal 审批知识文档",
    parameters: z.object({
      scenarios: z.array(z.string()).optional().describe("场景过滤"),
      offset: z.number().int().nonnegative().optional(),
      limit: z.number().int().positive().optional()
    }),
    handler: async (
      client: KyInstance,
      params: { scenarios?: string[]; offset?: number; limit?: number }
    ) => api.listApprovalDocuments(client, params)
  },
  {
    name: "seal_approval_document_get",
    description: "获取 Seal 审批知识文档详情",
    parameters: z.object({
      documentId: z.string().describe("文档 ID")
    }),
    handler: async (client: KyInstance, params: { documentId: string }) =>
      api.getApprovalDocument(client, params.documentId)
  },
  {
    name: "seal_approval_document_create",
    description: "新建 Seal 审批知识文档",
    parameters: z.object({
      title: z.string(),
      purpose: z.string(),
      content: z.string().describe("正文，通常为 Markdown"),
      contentType: z.string().optional(),
      status: z.string().optional(),
      scenarios: z.array(z.string()).optional(),
      tags: z.array(z.string()).optional()
    }),
    handler: async (
      client: KyInstance,
      params: {
        title: string;
        purpose: string;
        content: string;
        contentType?: string;
        status?: string;
        scenarios?: string[];
        tags?: string[];
      }
    ) => api.createApprovalDocument(client, params)
  },
  {
    name: "seal_approval_document_update",
    description: "更新 Seal 审批知识文档",
    parameters: z.object({
      documentId: z.string(),
      title: z.string().optional(),
      purpose: z.string().optional(),
      content: z.string().optional(),
      contentType: z.string().optional(),
      status: z.string().optional(),
      enabled: z.boolean().optional(),
      scenarios: z.array(z.string()).optional(),
      tags: z.array(z.string()).optional()
    }),
    handler: async (
      client: KyInstance,
      params: {
        documentId: string;
        title?: string;
        purpose?: string;
        content?: string;
        contentType?: string;
        status?: string;
        enabled?: boolean;
        scenarios?: string[];
        tags?: string[];
      }
    ) => {
      const { documentId, ...rest } = params;
      return api.updateApprovalDocument(client, documentId, rest);
    }
  },
  {
    name: "seal_approval_search",
    description: "按关键词组检索 Seal 审批规则、审批文档和审批偏好配置，返回命中位置、字段、行号和前后三行上下文",
    parameters: z.object({
      keywords: z.array(z.string()).min(1).describe("关键词组"),
      matchMode: z.enum(["any", "all"]).optional().describe("any 命中任一关键词，all 要求同一行命中全部关键词"),
      areas: z.array(z.enum(["rules", "documents", "preferences"])).optional().describe("检索范围"),
      caseSensitive: z.boolean().optional().describe("是否大小写敏感"),
      contextLines: z.number().int().nonnegative().optional().describe("返回命中行前后几行，默认 3"),
      documentLimit: z.number().int().positive().optional().describe("缓存刷新时最多拉取文档数，默认 100"),
      maxResults: z.number().int().positive().optional().describe("最多返回命中数，默认 50"),
      refresh: z.boolean().optional().describe("是否跳过 5 分钟内存缓存并强制刷新"),
      ruleVersionScope: z.enum(["current", "all", "version"]).optional().describe("规则检索范围，默认 current；all 会检索所有已发布历史版本"),
      ruleVersionId: z.string().optional().describe("ruleVersionScope=version 时指定版本 ID"),
      ruleVersionNumber: z.number().int().positive().optional().describe("ruleVersionScope=version 时指定版本号"),
      latestRuleVersion: z.boolean().optional().describe("ruleVersionScope=version 时取最新已发布版本"),
      snippetOnly: z.boolean().optional().describe("只返回命中行，不返回前后文"),
      maxChars: z.number().int().positive().optional().describe("每个文本片段最多返回字符数"),
      fields: z.array(z.string()).optional().describe("只搜索指定字段，如 history.description、description、scope")
    }),
    handler: async (
      client: KyInstance,
      params: {
        keywords: string[];
        matchMode?: "any" | "all";
        areas?: Array<"rules" | "documents" | "preferences">;
        caseSensitive?: boolean;
        contextLines?: number;
        documentLimit?: number;
        maxResults?: number;
        refresh?: boolean;
        ruleVersionScope?: "current" | "all" | "version";
        ruleVersionId?: string;
        ruleVersionNumber?: number;
        latestRuleVersion?: boolean;
        snippetOnly?: boolean;
        maxChars?: number;
        fields?: string[];
      },
      context: ToolContext
    ) => searchApprovalContent(client, context.corp, params)
  },
  {
    name: "seal_approval_context_get",
    description: "聚合获取 Seal 现有审批规则、审批文档和审批风格偏好",
    parameters: z.object({
      documentLimit: z.number().int().positive().optional().describe("最多返回的审批文档数量"),
      ruleVersionId: z.string().optional().describe("指定已发布规则版本 ID；指定后 rules 返回该版本快照"),
      ruleVersionNumber: z.number().int().positive().optional().describe("指定已发布规则版本号；指定后 rules 返回该版本快照"),
      latestRuleVersion: z.boolean().optional().describe("为 true 时 rules 返回最新已发布版本快照")
    }),
    handler: async (
      client: KyInstance,
      params: {
        documentLimit?: number;
        ruleVersionId?: string;
        ruleVersionNumber?: number;
        latestRuleVersion?: boolean;
      },
      context: ToolContext
    ) => {
      const currentContext = await api.getApprovalContext(client, {
        documentLimit: params.documentLimit,
        stylePreferencesEndpoint: context.corp.seal.endpoints.approvalStylePreferences
      });

      if (!params.ruleVersionId && !params.ruleVersionNumber && !params.latestRuleVersion) {
        return currentContext;
      }

      const version = await resolveRuleVersion(client, params);
      return {
        ...currentContext,
        rules: {
          version: summarizeRuleVersion(version),
          rules: version.rules
        }
      };
    }
  },
  {
    name: "seal_approval_style_preferences_get",
    description: "获取 Seal 审批风格偏好配置",
    parameters: z.object({}),
    handler: async (client: KyInstance, _params: unknown, context: ToolContext) =>
      api.getApprovalStylePreferences(
        client,
        context.corp.seal.endpoints.approvalStylePreferences
      )
  },
  {
    name: "seal_approval_style_preferences_update",
    description: "更新 Seal 审批风格偏好配置",
    parameters: z.object({
      tone: z.string().optional(),
      language: z.string().optional(),
      detailLevel: z.string().optional(),
      outputFormat: z.string().optional(),
      examples: z.array(z.string()).optional(),
      prohibitedPhrases: z.array(z.string()).optional(),
      customInstructions: z.string().optional()
    }),
    handler: async (
      client: KyInstance,
      params: Record<string, unknown>,
      context: ToolContext
    ) =>
      api.updateApprovalStylePreferences(
        client,
        params,
        context.corp.seal.endpoints.approvalStylePreferences
      )
  },
  {
    name: "seal_approval_runs_search",
    description: "查询 Seal 审批/审核运行记录总表，并整理合思单据到 Langfuse trace/session 的桥接字段",
    parameters: z.object({
      offset: z.number().int().nonnegative().optional(),
      limit: z.number().int().positive().max(100).optional(),
      fromTimestamp: z.string().optional(),
      toTimestamp: z.string().optional(),
      startDate: z.string().optional().describe("运行记录创建开始时间戳（毫秒），对应前端 startDate"),
      endDate: z.string().optional().describe("运行记录创建结束时间戳（毫秒），对应前端 endDate"),
      status: z.string().optional(),
      taskMode: z.string().optional(),
      manualApprovalStatus: z.union([z.string(), z.array(z.string())]).optional().describe("人工审核状态，如 TERMINATED 对应已驳回"),
      sourceDocumentSN: z.string().optional(),
      sourceDocumentId: z.string().optional(),
      humanResult: z.string().optional().describe("按人工审批结果做本地包含匹配，如 驳回、通过、reject"),
      query: z.string().optional().describe("在 id、sourceDocumentSN、sourceDocumentId、documentId、Langfuse traceId 中做本地包含匹配"),
      includeBridge: z.boolean().optional().describe("是否返回完整 bridge 数组；默认 false，避免长输出")
    }),
    handler: async (
      client: KyInstance,
      params: {
        offset?: number;
        limit?: number;
        fromTimestamp?: string;
        toTimestamp?: string;
        startDate?: string;
        endDate?: string;
        status?: string;
        taskMode?: string;
        manualApprovalStatus?: string | string[];
        sourceDocumentSN?: string;
        sourceDocumentId?: string;
        humanResult?: string;
        query?: string;
        includeBridge?: boolean;
      }
    ) => {
      const query = params.query?.trim();
      const data = await api.listApprovalRuns(client, withApprovalRunFilters({
        ...params,
        search: query
      }));
      const records = await prepareApprovalRuns(client, data.records, {
        humanResult: params.humanResult
      });

      return {
        ...data,
        records: records.map(summarizeApprovalRun),
        ...(params.includeBridge ? { bridge: summarizeRunBridge(records) } : {})
      };
    }
  },
  {
    name: "seal_approval_runs_summary",
    description: "按本地日期/时区汇总 Seal 审批运行记录，返回状态、模式统计和精简记录，避免长 JSON 输出",
    parameters: z.object({
      date: z.string().optional().describe("本地日期，格式 YYYY-MM-DD；默认使用 timezone 下的今天"),
      timezone: z.string().optional().describe("IANA 时区，默认 Asia/Shanghai"),
      offset: z.number().int().nonnegative().optional(),
      limit: z.number().int().positive().max(100).optional(),
      startDate: z.string().optional().describe("运行记录创建开始时间戳（毫秒），对应前端 startDate"),
      endDate: z.string().optional().describe("运行记录创建结束时间戳（毫秒），对应前端 endDate"),
      status: z.string().optional(),
      taskMode: z.string().optional(),
      manualApprovalStatus: z.union([z.string(), z.array(z.string())]).optional().describe("人工审核状态，如 TERMINATED 对应已驳回"),
      sourceDocumentSN: z.string().optional(),
      sourceDocumentId: z.string().optional(),
      humanResult: z.string().optional().describe("按人工审批结果做本地包含匹配，如 驳回、通过、reject"),
      query: z.string().optional().describe("在 id、sourceDocumentSN、sourceDocumentId、documentId、Langfuse traceId 中做本地包含匹配")
    }),
    handler: async (
      client: KyInstance,
      params: {
        date?: string;
        timezone?: string;
        offset?: number;
        limit?: number;
        startDate?: string;
        endDate?: string;
        status?: string;
        taskMode?: string;
        manualApprovalStatus?: string | string[];
        sourceDocumentSN?: string;
        sourceDocumentId?: string;
        humanResult?: string;
        query?: string;
      }
    ) => {
      const timezone = params.timezone ?? "Asia/Shanghai";
      const date = params.date ?? localDateKey(Date.now(), timezone) ?? "";
      const data = await api.listApprovalRuns(client, {
        offset: params.offset,
        limit: params.limit ?? 100,
        startDate: params.startDate,
        endDate: params.endDate,
        status: params.status,
        taskMode: params.taskMode,
        manualApprovalStatus: resolveManualApprovalStatus(
          params.manualApprovalStatus,
          params.humanResult
        ),
        sourceDocumentSN: params.sourceDocumentSN,
        sourceDocumentId: params.sourceDocumentId
      });
      const records = (
        await prepareApprovalRuns(client, data.records, {
          query: params.query,
          humanResult: params.humanResult
        })
      ).filter((record) => localDateKey(record.createdAt, timezone) === date);

      return summarizeApprovalRuns(records, {
        date,
        timezone,
        fetched: data.records.length,
        total: data.total
      });
    }
  },
  {
    name: "seal_approval_run_get",
    description: "获取 Seal 单条审批/审核运行记录详情；可用 fields 只取 metadata、document.fields、result.summary 等局部字段",
    parameters: z.object({
      recordId: z.string().describe("Seal approval run record ID"),
      fields: z.union([z.string(), z.array(z.string())]).optional().describe("逗号分隔或数组形式的字段路径，如 metadata、document.fields、result.summary"),
      summary: z.boolean().optional().describe("返回单据摘要、AI 结果、人工结果和版本号")
    }),
    handler: async (
      client: KyInstance,
      params: { recordId: string; fields?: string | string[]; summary?: boolean }
    ) => {
      const record = await api.getApprovalRun(client, params.recordId);
      if (params.summary) return summarizeApprovalRunDetail(record);
      const full = {
        ...record,
        aliases: approvalRunAliases(record),
        humanResult: extractHumanResult(record)
      };
      const fields = parseFieldPaths(params.fields);
      return fields.length > 0 ? pickRunFields(full, fields) : full;
    }
  },
  {
    name: "seal_approval_run_cited_rules_get",
    description: "从审批运行结果中抽取 AI 引用或命中的规则及应用分析",
    parameters: z.object({
      recordId: z.string().describe("Seal approval run record ID")
    }),
    handler: async (
      client: KyInstance,
      params: { recordId: string }
    ) => {
      const record = await api.getApprovalRun(client, params.recordId);
      return extractCitedRules(record);
    }
  },
  {
    name: "seal_approval_run_document_summary_get",
    description: "返回单据关键字段、附件摘要、AI/人工结果，避免拉取完整原始单据",
    parameters: z.object({
      recordId: z.string().describe("Seal approval run record ID")
    }),
    handler: async (
      client: KyInstance,
      params: { recordId: string }
    ) => {
      const record = await api.getApprovalRun(client, params.recordId);
      return summarizeApprovalRunDocument(record);
    }
  },
  {
    name: "seal_approval_run_attachments_get",
    description: "从审批运行记录中抽取附件、发票附件和字段位置，不返回完整单据正文和规则结果",
    parameters: z.object({
      recordId: z.string().describe("Seal approval run record ID"),
      summary: z.boolean().optional().describe("只返回附件列表摘要")
    }),
    handler: async (
      client: KyInstance,
      params: { recordId: string; summary?: boolean }
    ) => {
      const record = await api.getApprovalRun(client, params.recordId);
      return extractApprovalRunAttachments(record, { summary: params.summary });
    }
  },
  {
    name: "seal_approval_run_result_get",
    description: "返回审批运行结果摘要；summary=true 时只返回 decision、summary、风险点数量、命中规则数量、traceId 等",
    parameters: z.object({
      recordId: z.string().describe("Seal approval run record ID"),
      summary: z.boolean().optional()
    }),
    handler: async (
      client: KyInstance,
      params: { recordId: string; summary?: boolean }
    ) => {
      const record = await api.getApprovalRun(client, params.recordId);
      if (params.summary) return summarizeApprovalRunResult(record);
      return {
        recordId: record.id,
        result: record.result
      };
    }
  },
  {
    name: "seal_approval_run_url_get",
    description: "获取合思企业协助链接，按需附带单据链接；支持只取企业协助链接，或按 Seal recordId/合思 sourceDocumentSN 查询单据链接",
    parameters: z.object({
      recordId: z.string().optional().describe("Seal approval run record ID"),
      sourceDocumentSN: z.string().optional().describe("合思/易快报单号"),
      sourceDocumentId: z.string().optional().describe("合思/易快报源单据 ID")
    }),
    handler: async (
      client: KyInstance,
      params: { recordId?: string; sourceDocumentSN?: string; sourceDocumentId?: string },
      context: ToolContext
    ) => {
      const hasDocumentLookup = Boolean(params.recordId || params.sourceDocumentSN || params.sourceDocumentId);
      const record = hasDocumentLookup ? await resolveApprovalRunForUrl(client, params) : undefined;
      const source = context.corp.source;
      const enterpriseAssistUrl = source.type === "hose" ? await getHoseEnterpriseUrl(context.corp) : undefined;
      const documentUrl = stringFromUnknown(record?.sourceExtendData?.hosecloudViewUrl);

      return {
        enterpriseAssistUrl,
        enterpriseUrl: enterpriseAssistUrl,
        hoseDomain: source.type === "hose" ? normalizeUrl(source.domain) : undefined,
        documentUrl,
        recordId: record?.id,
        sourceDocumentSN: record?.sourceDocumentSN,
        sourceDocumentId: record?.sourceDocumentId,
        sourceSystem: record?.sourceSystem,
        missing: {
          enterpriseAssistUrl: enterpriseAssistUrl ? undefined : "Current enterprise source is not Hose, so no Hose enterprise assist URL is configured.",
          documentUrl: hasDocumentLookup && !documentUrl ? "sourceExtendData.hosecloudViewUrl is absent from the approval run detail." : undefined
        }
      };
    }
  },
  {
    name: "seal_approval_run_pick",
    description: "按合思单号或关键字查询运行记录，返回候选记录及其当时使用的规则版本，便于再取详情或查版本规则",
    parameters: z.object({
      query: z.string().optional().describe("合思单号、源单据 ID、运行记录 ID 或 trace 关键字"),
      sn: z.string().optional().describe("合思/易快报单号；优先作为精确 sourceDocumentSN 查询"),
      batchId: z.string().optional().describe("模拟批次 ID"),
      latest: z.boolean().optional().describe("只返回最新一条匹配记录"),
      fields: z.union([z.string(), z.array(z.string())]).optional().describe("限制返回字段"),
      limit: z.number().int().positive().max(100).optional(),
      maxScan: z.number().int().positive().max(5000).optional().describe("最多扫描多少条运行记录用于本地匹配，默认 1000"),
      includeBridge: z.boolean().optional()
    }),
    handler: async (
      client: KyInstance,
      params: {
        query?: string;
        sn?: string;
        batchId?: string;
        latest?: boolean;
        fields?: string | string[];
        limit?: number;
        maxScan?: number;
        includeBridge?: boolean;
      }
    ) => {
      const query = params.sn ?? params.query;
      if (!query) throw new Error("query or sn is required");
      const picked = await pickApprovalRuns(client, {
        query,
        sn: params.sn,
        batchId: params.batchId,
        latest: params.latest,
        limit: params.latest ? 1 : params.limit ?? 20,
        maxScan: params.maxScan ?? 1000
      });
      const records = await Promise.all(
        picked.records.map((record) => api.getApprovalRun(client, record.id))
      );
      const fields = parseFieldPaths(params.fields);
      const projected = records.map((record) => pickApprovalRunCandidate(record, fields));

      return {
        query,
        sourceDocumentSN: params.sn,
        simulationBatchId: params.batchId,
        latest: params.latest ?? false,
        total: picked.total,
        scanned: picked.scanned,
        matched: projected.length,
        records: projected,
        next: {
          getSummary: "seal-home approval-runs get <recordId> --summary",
          getRuleVersion: "seal-home rules version <ruleSetVersionNumber>",
          searchRuleVersion: "seal-home tool seal_approval_search --json '{\"keywords\":[\"关键词\"],\"areas\":[\"rules\"],\"ruleVersionScope\":\"version\",\"ruleVersionNumber\":14}'",
          getVersionContext: "seal-home tool seal_approval_context_get --json '{\"ruleVersionNumber\":14}'"
        },
        ...(params.includeBridge ? { bridge: summarizeRunBridge(records) } : {})
      };
    }
  },
  {
    name: "seal_simulation_batch_records_get",
    description: "获取某一次 Seal 模拟批次的运行记录，并整理对应 Langfuse trace/session 桥接字段",
    parameters: z.object({
      batchId: z.string().describe("simulation batch ID"),
      query: z.string().optional().describe("在 id、sourceDocumentSN、sourceDocumentId、documentId、Langfuse traceId 中做本地包含匹配")
    }),
    handler: async (
      client: KyInstance,
      params: { batchId: string; query?: string }
    ) => {
      const records = filterRuns(
        await api.listSimulationBatchRecords(client, params.batchId),
        params.query
      );

      return {
        batchId: params.batchId,
        count: records.length,
        records: records.map(summarizeApprovalRun),
        bridge: summarizeRunBridge(records)
      };
    }
  },
  {
    name: "seal_approval_run_langfuse_bridge_get",
    description: "从 Seal approval run 中抽取 Langfuse 定位信息；优先返回 _langfuseTraceId，没有时给出 hosecloud-{sourceDocumentSN} session 回退",
    parameters: z.object({
      recordId: z.string().optional(),
      sourceDocumentSN: z.string().optional(),
      sourceDocumentId: z.string().optional(),
      simulationBatchId: z.string().optional(),
      limit: z.number().int().positive().max(100).optional()
    }),
    handler: async (
      client: KyInstance,
      params: {
        recordId?: string;
        sourceDocumentSN?: string;
        sourceDocumentId?: string;
        simulationBatchId?: string;
        limit?: number;
      }
    ) => {
      const records = params.simulationBatchId
        ? await api.listSimulationBatchRecords(client, params.simulationBatchId)
        : (await api.listApprovalRuns(client, {
            limit: params.limit ?? 50,
            search: params.sourceDocumentSN ?? params.sourceDocumentId,
            sourceDocumentSN: params.sourceDocumentSN,
            sourceDocumentId: params.sourceDocumentId
          })).records;

      const filtered = records.filter((record) =>
        matchesRunLookup(record, {
          recordId: params.recordId,
          sourceDocumentSN: params.sourceDocumentSN,
          sourceDocumentId: params.sourceDocumentId
        })
      );

      return {
        count: filtered.length,
        records: filtered.map(summarizeApprovalRun),
        bridge: summarizeRunBridge(filtered)
      };
    }
  }
];

export type SealTool = (typeof sealTools)[number];

const sealToolByName = new Map<string, SealTool>(
  sealTools.map((tool) => [tool.name, tool])
);

const mcpDirectToolNames = [
  "seal_whoami",
  "seal_approval_search",
  "seal_approval_context_get"
] as const;

const sealActionNames = [
  "seal_session_get",
  "seal_approval_rules_list",
  "seal_approval_rule_create",
  "seal_approval_rule_update",
  "seal_approval_rule_delete",
  "seal_approval_rule_versions_list",
  "seal_approval_rule_version_get",
  "seal_approval_rule_get",
  "seal_approval_rule_version_publish",
  "seal_approval_documents_list",
  "seal_approval_document_get",
  "seal_approval_document_create",
  "seal_approval_document_update",
  "seal_approval_style_preferences_get",
  "seal_approval_style_preferences_update",
  "seal_approval_runs_summary",
  "seal_approval_run_get",
  "seal_approval_run_cited_rules_get",
  "seal_approval_run_document_summary_get",
  "seal_approval_run_attachments_get",
  "seal_approval_run_result_get",
  "seal_approval_run_url_get",
  "seal_approval_run_pick",
  "seal_simulation_batch_records_get",
  "seal_approval_run_langfuse_bridge_get"
] as const;

const sealActionAliases: Record<string, (typeof sealActionNames)[number]> = {
  "session.get": "seal_session_get",
  "rule.list": "seal_approval_rules_list",
  "rule.create": "seal_approval_rule_create",
  "rule.update": "seal_approval_rule_update",
  "rule.delete": "seal_approval_rule_delete",
  "rule.versions.list": "seal_approval_rule_versions_list",
  "rule.version.get": "seal_approval_rule_version_get",
  "rule.get": "seal_approval_rule_get",
  "rule.publish": "seal_approval_rule_version_publish",
  "doc.list": "seal_approval_documents_list",
  "doc.get": "seal_approval_document_get",
  "doc.create": "seal_approval_document_create",
  "doc.update": "seal_approval_document_update",
  "style.get": "seal_approval_style_preferences_get",
  "style.update": "seal_approval_style_preferences_update",
  "runs.summary": "seal_approval_runs_summary",
  "runs.get": "seal_approval_run_get",
  "runs.citedRules": "seal_approval_run_cited_rules_get",
  "runs.documentSummary": "seal_approval_run_document_summary_get",
  "runs.attachments": "seal_approval_run_attachments_get",
  "runs.result": "seal_approval_run_result_get",
  "runs.url": "seal_approval_run_url_get",
  "runs.pick": "seal_approval_run_pick",
  "batch.records.get": "seal_simulation_batch_records_get",
  "langfuse.bridge.get": "seal_approval_run_langfuse_bridge_get"
};

export const sealMcpTools: SealToolDefinition[] = [
  ...mcpDirectToolNames.map((name) => requiredTool(name)),
  {
    ...requiredTool("seal_approval_runs_search"),
    name: "seal_runs_search",
    description: "查询 Seal 审批/审核运行记录，返回精简记录并按需提供 Langfuse trace/session 关联"
  },
  {
    name: "seal_action",
    description: "Seal 低频管理操作统一入口。传 action=help 查看可用动作；支持 rule/doc/style/runs/batch/langfuse 等管理与诊断操作。",
    parameters: z.object({
      action: z.string().describe("动作名，如 help、rule.create、doc.update、runs.summary、langfuse.bridge.get；也兼容旧 tool 名"),
      payload: z.record(z.string(), z.unknown()).optional().describe("动作参数对象")
    }),
    handler: async (
      client: KyInstance,
      params: { action: string; payload?: Record<string, unknown> },
      context: ToolContext
    ) => runSealAction(client, params, context)
  }
];

export function findSealTool(name: string, options: { includeMcpAliases?: boolean } = {}) {
  if (options.includeMcpAliases && name === "seal_runs_search") {
    return requiredTool("seal_approval_runs_search");
  }
  return sealToolByName.get(name);
}

export function findSealMcpTool(name: string) {
  return sealMcpTools.find((tool) => tool.name === name);
}

async function runSealAction(
  client: KyInstance,
  params: { action: string; payload?: Record<string, unknown> },
  context: ToolContext
) {
  const action = params.action?.trim();
  if (!action || action === "help") {
    return sealActionHelp(params.payload?.topic);
  }

  const toolName = sealActionAliases[action] ?? action;
  if (!isSealActionToolName(toolName)) {
    return {
      error: `Unsupported seal_action action: ${action}`,
      help: sealActionHelp(params.payload?.topic)
    };
  }

  const tool = requiredTool(toolName);
  const payload = params.payload ?? {};
  return tool.handler(client, payload as never, context);
}

function sealActionHelp(topic: unknown) {
  const normalizedTopic = typeof topic === "string" ? topic.trim() : undefined;
  const actions = Object.entries(sealActionAliases)
    .filter(([action]) => !normalizedTopic || action.startsWith(`${normalizedTopic}.`))
    .map(([action, toolName]) => {
      const tool = requiredTool(toolName);
      return {
        action,
        toolName,
        description: tool.description
      };
    });

  return {
    usage: "seal_action({ action, payload })",
    topics: ["session", "rule", "doc", "style", "runs", "batch", "langfuse"],
    actions
  };
}

function requiredTool(name: string): SealTool {
  const tool = sealToolByName.get(name);
  if (!tool) throw new Error(`Missing Seal tool: ${name}`);
  return tool;
}

function isSealActionToolName(name: string): name is (typeof sealActionNames)[number] {
  return sealActionNames.includes(name as (typeof sealActionNames)[number]);
}

type ApprovalRunSummary = {
  id: string;
  tenantId?: string;
  agentId?: string;
  status?: string;
  taskMode?: string;
  finalExecutionMode?: string;
  sourceSystem?: string;
  sourceDocumentSN?: string;
  sourceDocumentId?: string;
  documentId?: string;
  simulationBatchId?: string;
  langfuseTraceId?: string;
  langfuseSessionFallback?: string;
  ruleSetVersionNumber?: number;
  ruleSetPublishedAt?: number;
  ruleSetPublishedByName?: string;
  humanResult?: string;
  humanResultPath?: string;
  aiDecision?: unknown;
  aiSummary?: unknown;
  createdAt?: string | number;
  updatedAt?: string | number;
};

type ApprovalRunsSummaryOptions = {
  date: string;
  timezone: string;
  fetched: number;
  total?: number;
};

type RuleField = keyof ApprovalRule;

function projectApprovalRules(
  data: { rules: ApprovalRule[]; hasPendingDeletes: boolean },
  params: {
    countOnly?: boolean;
    fields?: RuleField[];
    limit?: number;
    offset?: number;
  }
) {
  const count = data.rules.length;
  if (params.countOnly || params.limit === 0) {
    return { count };
  }

  const offset = params.offset ?? 0;
  const rules = data.rules.slice(offset, params.limit === undefined ? undefined : offset + params.limit);
  const fields = params.fields;

  return {
    count,
    hasPendingDeletes: data.hasPendingDeletes,
    rules: fields ? rules.map((rule) => pickRuleFields(rule, fields)) : rules
  };
}

function pickRuleFields(rule: ApprovalRule, fields: readonly RuleField[]) {
  const output: Partial<ApprovalRule> = {};
  for (const field of fields) {
    if (rule[field] !== undefined) {
      output[field] = rule[field] as never;
    }
  }
  return output;
}

function summarizeApprovalRun(record: ApprovalRun): ApprovalRunSummary {
  const sourceDocumentSN = record.sourceDocumentSN;
  const humanResult = extractHumanResult(record);
  const ai = summarizeApprovalRunResult(record);

  return {
    id: record.id,
    tenantId: record.tenantId,
    agentId: record.agentId,
    status: record.status,
    taskMode: record.taskMode,
    finalExecutionMode: record.finalExecutionMode,
    sourceSystem: record.sourceSystem,
    sourceDocumentSN,
    sourceDocumentId: record.sourceDocumentId,
    documentId: record.documentId,
    simulationBatchId: record.sourceExtendData?.simulation_batch_id,
    langfuseTraceId: record.sourceExtendData?._langfuseTraceId,
    langfuseSessionFallback: sourceDocumentSN ? `hosecloud-${sourceDocumentSN}` : undefined,
    ruleSetVersionNumber: record.ruleSetVersionNumber,
    ruleSetPublishedAt: record.ruleSetPublishedAt,
    ruleSetPublishedByName: record.ruleSetPublishedByName,
    humanResult: humanResult?.value,
    humanResultPath: humanResult?.path,
    aiDecision: ai.decision,
    aiSummary: ai.summary,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt
  };
}

function summarizeApprovalRuns(records: ApprovalRun[], options: ApprovalRunsSummaryOptions) {
  return {
    date: options.date,
    timezone: options.timezone,
    fetched: options.fetched,
    matched: records.length,
    total: options.total,
    statusCounts: countBy(records, (record) => record.status ?? "unknown"),
    taskModeCounts: countBy(records, (record) => record.taskMode ?? "unknown"),
    records: records.map((record) => {
      const summary = summarizeApprovalRun(record);
      return {
        createdAt: formatLocalDateTime(summary.createdAt, options.timezone),
        sourceDocumentSN: summary.sourceDocumentSN,
        sourceDocumentId: summary.sourceDocumentId,
        status: summary.status,
        taskMode: summary.taskMode,
        finalExecutionMode: summary.finalExecutionMode,
        simulationBatchId: summary.simulationBatchId,
        langfuseTraceId: summary.langfuseTraceId,
        langfuseSessionFallback: summary.langfuseSessionFallback,
        ruleSetVersionNumber: summary.ruleSetVersionNumber,
        ruleSetPublishedAt: formatLocalDateTime(summary.ruleSetPublishedAt, options.timezone),
        ruleSetPublishedByName: summary.ruleSetPublishedByName,
        humanResult: summary.humanResult,
        humanResultPath: summary.humanResultPath,
        recordId: summary.id
      };
    })
  };
}

function parseFieldPaths(fields: string | string[] | undefined): string[] {
  if (!fields) return [];
  const raw = Array.isArray(fields) ? fields : fields.split(",");
  return raw.map((field) => field.trim()).filter(Boolean);
}

function pickRunFields(record: Record<string, unknown>, fields: readonly string[]) {
  const output: Record<string, unknown> = {};
  for (const field of fields) {
    if (field === "metadata") {
      output.metadata = approvalRunMetadata(record as ApprovalRun);
      continue;
    }
    const value = getPath(record, field);
    if (value !== undefined) setPath(output, field, value);
  }
  return output;
}

function approvalRunMetadata(record: ApprovalRun) {
  const summary = summarizeApprovalRun(record);
  return {
    recordId: summary.id,
    tenantId: summary.tenantId,
    agentId: summary.agentId,
    sourceSystem: summary.sourceSystem,
    sourceDocumentSN: summary.sourceDocumentSN,
    sourceDocumentId: summary.sourceDocumentId,
    documentId: summary.documentId,
    status: summary.status,
    taskMode: summary.taskMode,
    finalExecutionMode: summary.finalExecutionMode,
    simulationBatchId: summary.simulationBatchId,
    langfuseTraceId: summary.langfuseTraceId,
    langfuseSessionFallback: summary.langfuseSessionFallback,
    ruleSetVersionNumber: summary.ruleSetVersionNumber,
    ruleSetPublishedAt: summary.ruleSetPublishedAt,
    ruleSetPublishedByName: summary.ruleSetPublishedByName,
    createdAt: summary.createdAt,
    updatedAt: summary.updatedAt
  };
}

function summarizeApprovalRunDetail(record: ApprovalRun) {
  return {
    metadata: approvalRunMetadata(record),
    document: summarizeApprovalRunDocument(record).document,
    aiResult: summarizeApprovalRunResult(record),
    manualResult: extractHumanResult(record)?.value,
    manualResultPath: extractHumanResult(record)?.path,
    ruleSetVersionNumber: record.ruleSetVersionNumber,
    ruleSetPublishedAt: record.ruleSetPublishedAt,
    ruleSetPublishedByName: record.ruleSetPublishedByName
  };
}

function summarizeApprovalRunResult(record: ApprovalRun) {
  const result = asRecord(record.result);
  return {
    recordId: record.id,
    sourceDocumentSN: record.sourceDocumentSN,
    sourceDocumentId: record.sourceDocumentId,
    traceId: record.sourceExtendData?._langfuseTraceId,
    langfuseTraceId: record.sourceExtendData?._langfuseTraceId,
    decision: firstPath(result, [
      "decision",
      "manualApproval.decision",
      "manualApproval.result",
      "review.decision",
      "finalDecision"
    ]),
    summary: firstPath(result, [
      "summary",
      "result.summary",
      "review.summary",
      "conclusion"
    ]),
    riskPointCount: countPathCandidates(result, [
      "riskPoints",
      "risks",
      "risk_points",
      "review.riskPoints"
    ]),
    matchedRuleCount: countPathCandidates(result, [
      "matchedRules",
      "hitRules",
      "ruleResults",
      "rules",
      "review.matchedRules"
    ])
  };
}

function summarizeApprovalRunDocument(record: ApprovalRun) {
  const document = asRecord(record.document);
  const fields = flattenDocumentFields(record.document);
  const fieldText = fields.map((field) => `${field.label ?? field.path ?? ""}:${field.value ?? ""}`).join("\n");
  return {
    recordId: record.id,
    sourceDocumentSN: record.sourceDocumentSN,
    sourceDocumentId: record.sourceDocumentId,
    document: compactObject({
      id: document?.id,
      sn: document?.sn ?? document?.sourceDocumentSN ?? record.sourceDocumentSN,
      title: document?.title ?? document?.name,
      template: firstPath(document, ["template.name", "templateName", "form.name", "formName", "formTitle"]),
      amount: firstByLabel(fields, ["金额", "报销金额", "付款金额", "合计", "价税合计"]) ?? firstPath(document, ["amount", "totalAmount", "expenseAmount"]),
      expenseType: firstByLabel(fields, ["费用类型", "费用类别", "报销类型"]),
      costCompany: firstByLabel(fields, ["费用承担公司", "承担公司", "成本中心", "费用归属"]),
      payee: firstByLabel(fields, ["收款方", "收款账户", "收款信息", "开户名", "银行账号"]),
      keyFields: fields.slice(0, 30)
    }),
    invoices: collectInvoiceSummary(record),
    attachments: extractApprovalRunAttachments(record, { summary: true }).attachments,
    aiResult: summarizeApprovalRunResult(record),
    manualResult: extractHumanResult(record)?.value,
    hints: compactObject({
      amountMentions: findKeywordLines(fieldText, ["金额", "合计", "税率"], 8),
      partyMentions: findKeywordLines(fieldText, ["买方", "卖方", "甲方", "乙方", "收款"], 8)
    })
  };
}

function extractApprovalRunAttachments(record: ApprovalRun, options: { summary?: boolean } = {}) {
  const roots: Array<[string, unknown]> = [
    ["document", record.document],
    ["result", record.result],
    ["pipelineData", record.pipelineData],
    ["sourceExtendData", record.sourceExtendData]
  ];
  const attachments: Array<Record<string, unknown>> = [];
  const seen = new Set<string>();

  for (const [path, value] of roots) {
    collectAttachments(value, path, attachments, seen);
  }

  return {
    recordId: record.id,
    sourceDocumentSN: record.sourceDocumentSN,
    sourceDocumentId: record.sourceDocumentId,
    count: attachments.length,
    attachments: options.summary
      ? attachments.map((attachment) => compactObject({
        path: attachment.path,
        kind: attachment.kind,
        fileName: attachment.fileName,
        mimeType: attachment.mimeType,
        fileId: attachment.fileId,
        sourceField: attachment.sourceField
      }))
      : attachments
  };
}

function extractCitedRules(record: ApprovalRun) {
  const candidates: Array<[string, unknown]> = [
    ["result.citedRules", getPath(record, "result.citedRules")],
    ["result.matchedRules", getPath(record, "result.matchedRules")],
    ["result.ruleResults", getPath(record, "result.ruleResults")],
    ["result.rules", getPath(record, "result.rules")],
    ["pipelineData.citedRules", getPath(record, "pipelineData.citedRules")],
    ["pipelineData.matchedRules", getPath(record, "pipelineData.matchedRules")]
  ];
  const rules: Array<Record<string, unknown>> = [];
  const seen = new Set<string>();

  for (const [path, value] of candidates) {
    const items = Array.isArray(value)
      ? value
      : value && typeof value === "object"
        ? Object.values(value as Record<string, unknown>)
        : [];
    items.forEach((item, index) => {
      const object = asRecord(item);
      if (!object) return;
      const runtimeRuleId = stringFromUnknown(object.runtimeRuleId) ?? stringFromUnknown(object.runtimeId) ?? stringFromUnknown(object.id) ?? stringFromUnknown(object.ruleId);
      const ruleCode = stringFromUnknown(object.ruleCode) ?? stringFromUnknown(object.code) ?? (runtimeRuleId ? runtimeRuleIdToCode(runtimeRuleId) : undefined);
      const output = compactObject({
        runtimeRuleId,
        ruleCode,
        versionNumber: numberFromUnknown(object.versionNumber) ?? record.ruleSetVersionNumber,
        scope: stringFromUnknown(object.scope),
        strictness: stringFromUnknown(object.strictness),
        appliedAnalysis: object.appliedAnalysis ?? object.analysis ?? object.reasoning,
        checkResult: object.checkResult ?? object.result ?? object.decision,
        findings: object.findings ?? object.riskPoints ?? object.evidence,
        sourcePath: `${path}.${index}`
      });
      const key = JSON.stringify(output);
      if (!seen.has(key)) {
        seen.add(key);
        rules.push(output);
      }
    });
  }

  return {
    recordId: record.id,
    sourceDocumentSN: record.sourceDocumentSN,
    sourceDocumentId: record.sourceDocumentId,
    ruleSetVersionNumber: record.ruleSetVersionNumber,
    count: rules.length,
    rules
  };
}

function collectAttachments(
  value: unknown,
  path: string,
  output: Array<Record<string, unknown>>,
  seen: Set<string>
) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectAttachments(item, `${path}.${index}`, output, seen));
    return;
  }

  const object = asRecord(value);
  if (!object) return;

  if (looksLikeAttachment(object, path)) {
    const attachment = compactObject({
      path,
      fieldPath: path,
      kind: inferAttachmentKind(path, object),
      fileName: stringFromUnknown(object.fileName) ?? stringFromUnknown(object.filename) ?? stringFromUnknown(object.name) ?? stringFromUnknown(object.originalName),
      mimeType: stringFromUnknown(object.mimeType) ?? stringFromUnknown(object.mimetype) ?? stringFromUnknown(object.contentType),
      fileId: stringFromUnknown(object.fileId) ?? stringFromUnknown(object.id) ?? stringFromUnknown(object.attachmentId),
      ossPath: stringFromUnknown(object.ossPath) ?? stringFromUnknown(object.ossKey) ?? stringFromUnknown(object.key),
      url: stringFromUnknown(object.url) ?? stringFromUnknown(object.signedUrl) ?? stringFromUnknown(object.downloadUrl) ?? stringFromUnknown(object.previewUrl),
      invoiceId: stringFromUnknown(object.invoiceId),
      sourceField: stringFromUnknown(object.fieldName) ?? stringFromUnknown(object.label)
    });
    const key = JSON.stringify(attachment);
    if (!seen.has(key)) {
      seen.add(key);
      output.push(attachment);
    }
  }

  for (const [key, child] of Object.entries(object)) {
    collectAttachments(child, `${path}.${key}`, output, seen);
  }
}

function looksLikeAttachment(object: Record<string, unknown>, path: string) {
  const keys = Object.keys(object).map((key) => key.toLowerCase());
  const pathHint = /(attachment|attachments|invoice|receipt|file|files|附件|发票)/i.test(path);
  const fileHints = ["filename", "fileName", "mimeType", "mimetype", "contentType", "fileId", "ossPath", "signedUrl", "downloadUrl", "previewUrl", "attachmentId"];
  return pathHint && fileHints.some((key) => keys.includes(key.toLowerCase()));
}

function inferAttachmentKind(path: string, object: Record<string, unknown>) {
  const normalized = `${path} ${stringFromUnknown(object.type) ?? ""}`.toLowerCase();
  if (normalized.includes("invoice") || normalized.includes("发票")) return "invoice";
  if (normalized.includes("receipt")) return "receipt";
  return "attachment";
}

function firstPath(object: Record<string, unknown> | undefined, paths: readonly string[]) {
  if (!object) return undefined;
  for (const path of paths) {
    const value = getPath(object, path);
    if (value !== undefined) return value;
  }
  return undefined;
}

function countPathCandidates(object: Record<string, unknown> | undefined, paths: readonly string[]) {
  if (!object) return 0;
  for (const path of paths) {
    const value = getPath(object, path);
    if (Array.isArray(value)) return value.length;
    if (value && typeof value === "object") return Object.keys(value).length;
    if (typeof value === "number") return value;
  }
  return 0;
}

function getPath(value: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((current, segment) => {
    if (current === undefined || current === null) return undefined;
    if (Array.isArray(current)) {
      const index = Number(segment);
      return Number.isInteger(index) ? current[index] : undefined;
    }
    if (typeof current === "object") {
      return (current as Record<string, unknown>)[segment];
    }
    return undefined;
  }, value);
}

function setPath(target: Record<string, unknown>, path: string, value: unknown) {
  const segments = path.split(".");
  let current = target;
  for (const segment of segments.slice(0, -1)) {
    const existing = current[segment];
    if (!existing || typeof existing !== "object" || Array.isArray(existing)) {
      current[segment] = {};
    }
    current = current[segment] as Record<string, unknown>;
  }
  current[segments[segments.length - 1] ?? path] = value;
}

function compactObject(object: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(object).filter(([, value]) => value !== undefined));
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function numberFromUnknown(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function flattenDocumentFields(value: unknown) {
  const fields: Array<Record<string, unknown>> = [];
  collectDocumentFields(value, "document", fields);
  return fields;
}

function collectDocumentFields(value: unknown, path: string, output: Array<Record<string, unknown>>) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectDocumentFields(item, `${path}.${index}`, output));
    return;
  }

  const object = asRecord(value);
  if (!object) return;

  const label = stringFromUnknown(object.label) ?? stringFromUnknown(object.name) ?? stringFromUnknown(object.title) ?? stringFromUnknown(object.fieldName);
  const rawValue = object.value ?? object.displayValue ?? object.text ?? object.content;
  if (label && rawValue !== undefined && typeof rawValue !== "object") {
    output.push(compactObject({
      path,
      label,
      value: rawValue,
      type: stringFromUnknown(object.type) ?? stringFromUnknown(object.fieldType)
    }));
  }

  for (const [key, child] of Object.entries(object)) {
    if (key === "attachments") continue;
    collectDocumentFields(child, `${path}.${key}`, output);
  }
}

function firstByLabel(fields: Array<Record<string, unknown>>, labels: string[]) {
  const hit = fields.find((field) => {
    const label = stringFromUnknown(field.label) ?? "";
    return labels.some((item) => label.includes(item));
  });
  return hit?.value;
}

function collectInvoiceSummary(record: ApprovalRun) {
  const invoices: Array<Record<string, unknown>> = [];
  collectInvoiceObjects(record.result, "result", invoices);
  collectInvoiceObjects(record.document, "document", invoices);
  return invoices.slice(0, 20);
}

function collectInvoiceObjects(value: unknown, path: string, output: Array<Record<string, unknown>>) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectInvoiceObjects(item, `${path}.${index}`, output));
    return;
  }
  const object = asRecord(value);
  if (!object) return;
  if (/invoice|发票/i.test(path)) {
    output.push(compactObject({
      path,
      fileName: stringFromUnknown(object.fileName) ?? stringFromUnknown(object.filename) ?? stringFromUnknown(object.name),
      buyer: object.buyer ?? object.buyerName ?? object.purchaserName,
      seller: object.seller ?? object.sellerName,
      amount: object.amount ?? object.totalAmount ?? object.total,
      taxRate: object.taxRate,
      category: object.category ?? object.type
    }));
  }
  for (const [key, child] of Object.entries(object)) {
    collectInvoiceObjects(child, `${path}.${key}`, output);
  }
}

function findKeywordLines(text: string, keywords: string[], limit: number) {
  return text
    .split(/\r?\n/)
    .filter((line) => keywords.some((keyword) => line.includes(keyword)))
    .slice(0, limit);
}

function summarizeRunBridge(records: ApprovalRun[]) {
  return records.map((record) => {
    const summary = summarizeApprovalRun(record);
    return {
      recordId: summary.id,
      tenantId: summary.tenantId,
      agentId: summary.agentId,
      sourceDocumentSN: summary.sourceDocumentSN,
      sourceDocumentId: summary.sourceDocumentId,
      simulationBatchId: summary.simulationBatchId,
      langfuseTraceId: summary.langfuseTraceId,
      langfuseSessionFallback: summary.langfuseSessionFallback,
      ruleSetVersionNumber: summary.ruleSetVersionNumber,
      ruleSetPublishedAt: summary.ruleSetPublishedAt,
      ruleSetPublishedByName: summary.ruleSetPublishedByName,
      resolution:
        summary.langfuseTraceId
          ? "trace"
          : summary.langfuseSessionFallback
            ? "session-fallback"
            : "unresolved"
    };
  });
}

function summarizeRuleVersion(version: RuleSetVersion) {
  return {
    id: version.id,
    tenantId: version.tenantId,
    versionNumber: version.versionNumber,
    versionName: version.versionName,
    publishedBy: version.publishedBy,
    publishedByName: version.publishedByName,
    rulesCount: version.rules.length,
    publishedAt: version.publishedAt,
    createdAt: version.createdAt
  };
}

async function resolveRuleVersionForLookup(
  client: KyInstance,
  params: { versionId?: string; versionNumber?: number; latest?: boolean; recordId?: string }
) {
  if (params.recordId && !params.versionId && !params.versionNumber && !params.latest) {
    const record = await api.getApprovalRun(client, params.recordId);
    if (!record.ruleSetVersionNumber) {
      throw new Error(`Approval run ${params.recordId} has no ruleSetVersionNumber`);
    }
    return resolveRuleVersion(client, { versionNumber: record.ruleSetVersionNumber });
  }
  return resolveRuleVersion(client, params);
}

function findRuleInVersion(
  version: RuleSetVersion,
  selector: { code?: string; runtimeId?: string }
) {
  const normalizedCode = normalizeRuleCode(selector.code);
  const runtimeIndex = runtimeRuleIndex(selector.runtimeId);
  const index = normalizedCode ? Number(normalizedCode.slice(1)) : runtimeIndex;

  if (!index || index < 1) {
    throw new Error("Pass --code '#0038' or --runtime-id rule-205");
  }

  const rule = version.rules.find((item, itemIndex) => {
    const object = item as Record<string, unknown>;
    const itemCode = normalizeRuleCode(stringFromUnknown(object.code) ?? stringFromUnknown(object.ruleCode));
    return itemCode === normalizedCode || itemIndex + 1 === index;
  });
  if (!rule) return undefined;

  const object = rule as Record<string, unknown>;
  const position = version.rules.indexOf(rule) + 1;
  return compactObject({
    runtimeRuleId: stringFromUnknown(object.runtimeRuleId) ?? `rule-${position}`,
    ruleCode: normalizeRuleCode(stringFromUnknown(object.code) ?? stringFromUnknown(object.ruleCode)) ?? formatRuleCode(position),
    versionId: version.id,
    versionNumber: version.versionNumber,
    versionName: version.versionName,
    publishedAt: version.publishedAt,
    publishedByName: version.publishedByName,
    description: rule.description,
    scope: rule.scope,
    strictness: rule.strictness,
    status: stringFromUnknown(object.status)
  });
}

function normalizeRuleCode(value?: string) {
  if (!value) return undefined;
  const digits = value.match(/\d+/)?.[0];
  return digits ? formatRuleCode(Number(digits)) : value;
}

function runtimeRuleIndex(value?: string) {
  if (!value) return undefined;
  const match = value.match(/(\d+)$/);
  return match ? Number(match[1]) : undefined;
}

function runtimeRuleIdToCode(value: string) {
  const index = runtimeRuleIndex(value);
  return index ? formatRuleCode(index) : undefined;
}

function formatRuleCode(value: number) {
  return `#${String(value).padStart(4, "0")}`;
}

function pickApprovalRunCandidate(record: ApprovalRun, fields: string[]) {
  const summary = summarizeApprovalRun(record);
  const candidate = {
    recordId: summary.id,
    sourceDocumentSN: summary.sourceDocumentSN,
    sourceDocumentId: summary.sourceDocumentId,
    simulationBatchId: summary.simulationBatchId,
    status: summary.status,
    taskMode: summary.taskMode,
    ruleSetVersionNumber: summary.ruleSetVersionNumber,
    langfuseTraceId: summary.langfuseTraceId,
    manualResult: summary.humanResult,
    aiDecision: summary.aiDecision,
    aiSummary: summary.aiSummary,
    createdAt: summary.createdAt
  };
  if (fields.length === 0) return candidate;
  return pickRunFields(candidate, fields);
}

async function resolveApprovalRunForUrl(
  client: KyInstance,
  params: { recordId?: string; sourceDocumentSN?: string; sourceDocumentId?: string }
): Promise<ApprovalRun> {
  if (params.recordId) {
    return api.getApprovalRun(client, params.recordId);
  }

  const data = await api.listApprovalRuns(client, {
    limit: 1,
    search: params.sourceDocumentSN ?? params.sourceDocumentId,
    sourceDocumentSN: params.sourceDocumentSN,
    sourceDocumentId: params.sourceDocumentId
  });
  const record = data.records[0];
  if (!record) {
    const lookup = params.sourceDocumentSN
      ? `sourceDocumentSN ${params.sourceDocumentSN}`
      : `sourceDocumentId ${params.sourceDocumentId}`;
    throw new Error(`Approval run not found for ${lookup}`);
  }

  return api.getApprovalRun(client, record.id);
}

function normalizeUrl(value: string): string {
  return value.replace(/\/+$/, "");
}

function stringFromUnknown(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

async function pickApprovalRuns(
  client: KyInstance,
  params: { query: string; sn?: string; batchId?: string; latest?: boolean; limit: number; maxScan: number }
) {
  const pageSize = Math.min(100, Math.max(params.limit, 20));
  const records: ApprovalRun[] = [];
  let total: number | undefined;
  let scanned = 0;

  while (scanned < params.maxScan && records.length < params.limit) {
    const data = await api.listApprovalRuns(client, {
      offset: scanned,
      limit: Math.min(pageSize, params.maxScan - scanned),
      search: params.sn ?? params.query,
      sourceDocumentSN: params.sn
    });

    total = data.total;
    scanned += data.records.length;
    const filtered = filterRuns(data.records, params.query)
      .filter((record) => !params.sn || record.sourceDocumentSN === params.sn)
      .filter((record) => !params.batchId || record.sourceExtendData?.simulation_batch_id === params.batchId);
    records.push(...filtered);

    if (data.records.length === 0 || (total !== undefined && scanned >= total)) break;

  }

  records.sort((left, right) => timestampOf(right.createdAt) - timestampOf(left.createdAt));

  return {
    total,
    scanned,
    records: records.slice(0, params.latest ? 1 : params.limit)
  };
}

function timestampOf(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

async function resolveRuleVersion(
  client: KyInstance,
  params: { versionId?: string; versionNumber?: number; latestRuleVersion?: boolean; latest?: boolean }
) {
  if (params.versionId) return api.getApprovalRuleVersion(client, params.versionId);

  const versions = await api.listApprovalRuleVersions(client);
  const version = params.versionNumber
    ? versions.find((item) => item.versionNumber === params.versionNumber)
    : versions[0];

  if (!version) {
    throw new Error(params.versionNumber
      ? `Rule version not found: ${params.versionNumber}`
      : "No rule versions found");
  }

  return version;
}

function filterRuns(records: ApprovalRun[], query?: string): ApprovalRun[] {
  const normalized = query?.trim().toLowerCase();
  if (!normalized) return records;

  return records.filter((record) => {
    const directValues = [
      record.id,
      record.sourceDocumentSN,
      record.sourceDocumentId,
      record.documentId,
      record.sourceExtendData?._langfuseTraceId,
      record.sourceExtendData?.simulation_batch_id,
      record.status,
      record.taskMode,
      record.finalExecutionMode,
      record.sourceSystem,
      record.ruleSetVersionNumber,
      record.ruleSetPublishedByName
    ];

    return directValues.some((value) => scalarIncludes(value, normalized)) ||
      objectContainsScalar(record, normalized);
  });
}

function scalarIncludes(value: unknown, normalized: string): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value).toLowerCase().includes(normalized);
  }
  return false;
}

function objectContainsScalar(value: unknown, normalized: string, depth = 0): boolean {
  if (depth > 6) return false;
  if (scalarIncludes(value, normalized)) return true;
  if (!value || typeof value !== "object") return false;

  if (Array.isArray(value)) {
    return value.some((item) => objectContainsScalar(item, normalized, depth + 1));
  }

  return Object.entries(value as Record<string, unknown>).some(([key, item]) =>
    scalarIncludes(key, normalized) || objectContainsScalar(item, normalized, depth + 1)
  );
}

function filterRunsByHumanResult(records: ApprovalRun[], humanResult?: string): ApprovalRun[] {
  const normalized = humanResult?.trim().toLowerCase();
  if (!normalized) return records;

  return records.filter((record) =>
    extractHumanResult(record)?.value.toLowerCase().includes(normalized)
  );
}

function withApprovalRunFilters<T extends {
  manualApprovalStatus?: string | string[];
  humanResult?: string;
}>(params: T) {
  return {
    ...params,
    manualApprovalStatus: resolveManualApprovalStatus(
      params.manualApprovalStatus,
      params.humanResult
    )
  };
}

function resolveManualApprovalStatus(
  manualApprovalStatus?: string | string[],
  humanResult?: string
): string | string[] | undefined {
  if (manualApprovalStatus) return manualApprovalStatus;

  const normalized = humanResult?.trim().toLowerCase();
  if (!normalized) return undefined;
  if (["驳回", "已驳回", "拒绝", "不通过", "terminated", "reject", "rejected", "denied"].includes(normalized)) {
    return "TERMINATED";
  }

  return undefined;
}

async function prepareApprovalRuns(
  client: KyInstance,
  records: ApprovalRun[],
  filters: {
    query?: string;
    humanResult?: string;
  }
): Promise<ApprovalRun[]> {
  const queriedRecords = filterRuns(records, filters.query);
  if (!filters.humanResult?.trim()) return queriedRecords;

  const detailedRecords = await Promise.all(
    queriedRecords.map(async (record) => {
      if (extractHumanResult(record)) return record;

      try {
        return await api.getApprovalRun(client, record.id);
      } catch {
        return record;
      }
    })
  );

  return filterRunsByHumanResult(detailedRecords, filters.humanResult);
}

type HumanResultMatch = {
  value: string;
  path: string;
};

function approvalRunAliases(record: ApprovalRun) {
  return {
    originalDocumentData: {
      path: "document",
      frontendLabel: "单据原始数据",
      description: "前端详情页展示的单据原始数据对象",
      id: record.document?.id ?? record.documentId,
      sourceDocumentSN: record.document?.sourceDocumentSN ?? record.sourceDocumentSN,
      sourceDocumentId: record.document?.sourceDocumentId ?? record.sourceDocumentId
    },
    aiDocumentFields: {
      path: "document.fields",
      frontendLabel: "AI 看的单据",
      description: "AI 审核实际读取的字段数组，即单据原始数据中的 fields",
      fieldCount: record.document?.fields?.length
    },
    aiDocument: {
      path: "document.fields",
      frontendLabel: "AI 看的单据",
      description: "兼容别名，等同于 aiDocumentFields",
      aliasOf: "aiDocumentFields",
      fieldCount: record.document?.fields?.length
    },
    sourceDocument: {
      path: "sourceExtendData.hosecloudViewUrl",
      description: "合思原始单据入口；详情响应中只有入口和源单据 ID，不包含完整原始单据 JSON",
      sourceSystem: record.sourceSystem,
      sourceDocumentSN: record.sourceDocumentSN,
      sourceDocumentId: record.sourceDocumentId,
      originalDocumentId: record.sourceExtendData?.original_document_id,
      viewUrl: record.sourceExtendData?.hosecloudViewUrl
    },
    aiResult: {
      path: "result",
      description: "AI 最终审核结构化结果"
    },
    aiAuditLog: {
      path: "pipelineData.logs",
      description: "AI 审核过程日志"
    },
    manualApproval: {
      path: "manualApprovalRecord",
      description: "人工审核结果、节点和驳回原因"
    }
  };
}

function extractHumanResult(record: ApprovalRun): HumanResultMatch | undefined {
  const roots: Array<[string, unknown]> = [
    ["result", record.result],
    ["pipelineData", record.pipelineData]
  ];

  for (const [path, value] of roots) {
    const match = findHumanResultValue(value, path);
    if (match) return match;
  }

  return undefined;
}

function findHumanResultValue(
  value: unknown,
  path: string,
  depth = 0
): HumanResultMatch | undefined {
  if (depth > 8 || value === null || value === undefined) return undefined;

  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const match = findHumanResultValue(value[index], `${path}[${index}]`, depth + 1);
      if (match) return match;
    }
    return undefined;
  }

  if (typeof value !== "object") return undefined;

  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const childPath = `${path}.${key}`;
    const match = findHumanResultValue(child, childPath, depth + 1);
    if (match) return match;

    if (isHumanResultKey(key) || isHumanResultKey(childPath)) {
      const text = stringifyHumanResultValue(child);
      if (text) return { value: text, path: childPath };
    }
  }

  return undefined;
}

function isHumanResultKey(key: string): boolean {
  const normalized = key.toLowerCase();
  const isHuman =
    normalized.includes("human") ||
    normalized.includes("manual") ||
    normalized.includes("reviewer") ||
    normalized.includes("operator") ||
    key.includes("人工") ||
    key.includes("人工审批") ||
    key.includes("人工审核");
  const isResult =
    normalized.includes("result") ||
    normalized.includes("decision") ||
    normalized.includes("outcome") ||
    normalized.includes("conclusion") ||
    normalized.includes("action") ||
    key.includes("结果") ||
    key.includes("结论") ||
    key.includes("动作");

  return isHuman && isResult;
}

function stringifyHumanResultValue(value: unknown): string | undefined {
  if (typeof value === "string") return value.trim() || undefined;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (!value || typeof value !== "object") return undefined;

  const object = value as Record<string, unknown>;
  for (const key of ["label", "name", "text", "value", "result", "decision", "outcome", "status", "action"]) {
    const text = stringifyHumanResultValue(object[key]);
    if (text) return text;
  }

  return undefined;
}

function matchesRunLookup(
  record: ApprovalRun,
  lookup: {
    recordId?: string;
    sourceDocumentSN?: string;
    sourceDocumentId?: string;
  }
): boolean {
  if (lookup.recordId && record.id !== lookup.recordId) return false;
  if (lookup.sourceDocumentSN && record.sourceDocumentSN !== lookup.sourceDocumentSN) return false;
  if (lookup.sourceDocumentId && record.sourceDocumentId !== lookup.sourceDocumentId) return false;
  return true;
}

function countBy<T>(items: T[], keyFor: (item: T) => string): Record<string, number> {
  return items.reduce<Record<string, number>>((counts, item) => {
    const key = keyFor(item);
    counts[key] = (counts[key] ?? 0) + 1;
    return counts;
  }, {});
}

function localDateKey(value: string | number | undefined, timezone: string): string | undefined {
  const date = toDate(value);
  if (!date) return undefined;

  const parts = localParts(date, timezone);
  const year = parts.year;
  const month = (parts.month ?? "01").padStart(2, "0");
  const day = (parts.day ?? "01").padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatLocalDateTime(value: string | number | undefined, timezone: string): string | undefined {
  const date = toDate(value);
  if (!date) return undefined;

  const parts = localParts(date, timezone);
  const month = (parts.month ?? "01").padStart(2, "0");
  const day = (parts.day ?? "01").padStart(2, "0");
  const hour = (parts.hour ?? "00").padStart(2, "0");
  const minute = (parts.minute ?? "00").padStart(2, "0");
  const second = (parts.second ?? "00").padStart(2, "0");
  return `${parts.year ?? "0000"}-${month}-${day} ${hour}:${minute}:${second}`;
}

function toDate(value: string | number | undefined): Date | null {
  if (value === undefined) return null;

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function localParts(date: Date, timezone: string): Record<string, string> {
  return Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false
    })
      .formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value])
  );
}
