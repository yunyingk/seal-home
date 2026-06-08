import { z } from "zod";
import { KyInstance } from "ky";
import * as api from "./api.js";
import { CorpConfig } from "../../core/config/types.js";
import { searchApprovalContent } from "./search.js";
import type { ApprovalRun } from "./types.js";

type ToolContext = {
  corp: CorpConfig;
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
    description: "列出 Seal 当前草稿审批规则",
    parameters: z.object({}),
    handler: async (client: KyInstance) => api.listApprovalRules(client)
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
    description: "列出 Seal 已发布审批规则版本",
    parameters: z.object({}),
    handler: async (client: KyInstance) => api.listApprovalRuleVersions(client)
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
      ruleVersionId: z.string().optional().describe("ruleVersionScope=version 时指定版本 ID")
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
      },
      context: ToolContext
    ) => searchApprovalContent(client, context.corp, params)
  },
  {
    name: "seal_approval_context_get",
    description: "聚合获取 Seal 现有审批规则、审批文档和审批风格偏好",
    parameters: z.object({
      documentLimit: z.number().int().positive().optional().describe("最多返回的审批文档数量")
    }),
    handler: async (
      client: KyInstance,
      params: { documentLimit?: number },
      context: ToolContext
    ) =>
      api.getApprovalContext(client, {
        documentLimit: params.documentLimit,
        stylePreferencesEndpoint: context.corp.seal.endpoints.approvalStylePreferences
      })
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
      status: z.string().optional(),
      taskMode: z.string().optional(),
      sourceDocumentSN: z.string().optional(),
      sourceDocumentId: z.string().optional(),
      query: z.string().optional().describe("在 id、sourceDocumentSN、sourceDocumentId、documentId、Langfuse traceId 中做本地包含匹配")
    }),
    handler: async (
      client: KyInstance,
      params: {
        offset?: number;
        limit?: number;
        fromTimestamp?: string;
        toTimestamp?: string;
        status?: string;
        taskMode?: string;
        sourceDocumentSN?: string;
        sourceDocumentId?: string;
        query?: string;
      }
    ) => {
      const data = await api.listApprovalRuns(client, params);
      const records = filterRuns(data.records, params.query);

      return {
        ...data,
        records: records.map(summarizeApprovalRun),
        bridge: summarizeRunBridge(records)
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
  createdAt?: string | number;
  updatedAt?: string | number;
};

function summarizeApprovalRun(record: ApprovalRun): ApprovalRunSummary {
  const sourceDocumentSN = record.sourceDocumentSN;

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
    createdAt: record.createdAt,
    updatedAt: record.updatedAt
  };
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
      resolution:
        summary.langfuseTraceId
          ? "trace"
          : summary.langfuseSessionFallback
            ? "session-fallback"
            : "unresolved"
    };
  });
}

function filterRuns(records: ApprovalRun[], query?: string): ApprovalRun[] {
  const normalized = query?.trim().toLowerCase();
  if (!normalized) return records;

  return records.filter((record) =>
    [
      record.id,
      record.sourceDocumentSN,
      record.sourceDocumentId,
      record.documentId,
      record.sourceExtendData?._langfuseTraceId,
      record.sourceExtendData?.simulation_batch_id
    ].some((value) => value?.toLowerCase().includes(normalized))
  );
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
