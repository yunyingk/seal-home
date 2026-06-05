import { z } from "zod";
import { KyInstance } from "ky";
import * as api from "./api.js";
import { CorpConfig } from "../../core/config/types.js";

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
  }
];

export type SealTool = (typeof sealTools)[number];
