import { z } from "zod";

export const HosecloudStaffSchema = z.object({
  staffId: z.string(),
  name: z.string().optional(),
  code: z.string().default(""),
  bindTime: z.number().optional()
});

export const SealUserSchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  name: z.string(),
  isAdmin: z.boolean().default(false),
  permissions: z.array(z.string()).default([]),
  providerUserId: z.string().optional(),
  hosecloudStaff: HosecloudStaffSchema.optional()
});

export const HoseCorpConfigSchema = z.object({
  apiKey: z.string().optional(),
  corporationId: z.string().optional(),
  corporationName: z.string().optional()
});

export const SealTenantSchema = z.object({
  id: z.string(),
  name: z.string(),
  tenantSlug: z.string().optional(),
  isDemo: z.boolean().default(false),
  logoUrl: z.string().nullable().optional(),
  hoseCorpConfig: HoseCorpConfigSchema.optional()
});

export const MeDataSchema = z.object({
  user: SealUserSchema,
  tenant: SealTenantSchema
});

export const ApprovalRuleSchema = z.object({
  id: z.string(),
  tenantId: z.string().optional(),
  description: z.string(),
  scope: z.string(),
  strictness: z.string(),
  status: z.string().optional(),
  createdAt: z.number().optional(),
  updatedAt: z.number().optional()
});

export const ApprovalRulesDataSchema = z.object({
  rules: z.array(ApprovalRuleSchema),
  hasPendingDeletes: z.boolean().default(false)
});

export const PublishedRuleSnapshotSchema = z.object({
  description: z.string(),
  scope: z.string(),
  strictness: z.string()
});

export const RuleSetVersionSchema = z.object({
  id: z.string(),
  tenantId: z.string().optional(),
  versionNumber: z.number(),
  versionName: z.string(),
  publishedBy: z.string().optional(),
  publishedByName: z.string().optional(),
  rules: z.array(PublishedRuleSnapshotSchema).default([]),
  publishedAt: z.number().optional(),
  createdAt: z.number().optional()
});

export const PublishVersionDataSchema = z.object({
  version: RuleSetVersionSchema,
  rulesCount: z.number()
});

export const ApprovalDocumentSchema = z.object({
  id: z.string(),
  tenantId: z.string().optional(),
  title: z.string(),
  purpose: z.string().default(""),
  contentType: z.string().default("policy"),
  content: z.string(),
  status: z.string().default("published"),
  enabled: z.boolean().default(true),
  scenarios: z.array(z.string()).default([]),
  tags: z.array(z.string()).default([]),
  category: z.string().nullable().optional(),
  categoryTags: z.array(z.string()).default([]),
  createdBy: z.string().nullable().optional(),
  createdByName: z.string().nullable().optional(),
  createdAt: z.number().optional(),
  updatedAt: z.number().optional(),
  updatedBy: z.string().nullable().optional(),
  updatedByName: z.string().nullable().optional(),
  isDeleted: z.boolean().default(false)
});

export const ApprovalDocumentListDataSchema = z.object({
  articles: z.array(ApprovalDocumentSchema),
  total: z.number().optional()
});

export const ApprovalStylePreferencesSchema = z.object({
  id: z.string().optional(),
  tenantId: z.string().optional(),
  tone: z.string().optional(),
  language: z.string().optional(),
  detailLevel: z.string().optional(),
  outputFormat: z.string().optional(),
  examples: z.array(z.string()).default([]),
  prohibitedPhrases: z.array(z.string()).default([]),
  customInstructions: z.string().optional(),
  updatedAt: z.number().optional()
}).passthrough();

export type MeData = z.infer<typeof MeDataSchema>;
export type ApprovalRule = z.infer<typeof ApprovalRuleSchema>;
export type ApprovalRulesData = z.infer<typeof ApprovalRulesDataSchema>;
export type RuleSetVersion = z.infer<typeof RuleSetVersionSchema>;
export type ApprovalDocument = z.infer<typeof ApprovalDocumentSchema>;
export type ApprovalDocumentListData = z.infer<typeof ApprovalDocumentListDataSchema>;
export type ApprovalStylePreferences = z.infer<typeof ApprovalStylePreferencesSchema>;
