import { z } from "zod";

export const HoseSealSourceSchema = z.object({
  type: z.literal("hose"),
  domain: z.string().url().default("https://app.ekuaibao.com"),
  appKey: z.string().optional(),
  appSecurity: z.string().optional(),
  key: z.string().optional(),
  password: z.string().optional(),
  staffId: z.string(),
  corpId: z.string(),
  sealUrl: z.string().url().optional()
}).superRefine((source, ctx) => {
  if (!source.appKey && !source.key) {
    ctx.addIssue({
      code: "custom",
      path: ["appKey"],
      message: "Hose source requires appKey or key"
    });
  }

  if (!source.appSecurity && !source.password) {
    ctx.addIssue({
      code: "custom",
      path: ["appSecurity"],
      message: "Hose source requires appSecurity or password"
    });
  }
});

export const DirectSealSourceSchema = z.object({
  type: z.literal("direct"),
  token: z.string(),
  sealUrl: z.string().url(),
  expiresIn: z.number().int().positive().default(3600),
  staffId: z.string().default("direct"),
  corpId: z.string().optional()
});

export const SealSourceSchema = z.discriminatedUnion("type", [
  HoseSealSourceSchema,
  DirectSealSourceSchema
]);

export const SealEndpointSchema = z.object({
  url: z.string().url().optional(),
  tenantSlug: z.string().optional(),
  endpoints: z.object({
    approvalStylePreferences: z.string().default("api/v1/agent/ai-approval/config")
  }).default({
    approvalStylePreferences: "api/v1/agent/ai-approval/config"
  })
}).default({
  endpoints: {
    approvalStylePreferences: "api/v1/agent/ai-approval/config"
  }
});

export const CorpAuthConfigSchema = z.object({
  refreshTtl: z.number().int().positive().default(300)
}).default({ refreshTtl: 300 });

export const CorpConfigSchema = z.object({
  id: z.string(),
  name: z.string(),
  seal: SealEndpointSchema,
  source: SealSourceSchema,
  auth: CorpAuthConfigSchema
});

export type HoseSealSource = z.infer<typeof HoseSealSourceSchema>;
export type DirectSealSource = z.infer<typeof DirectSealSourceSchema>;
export type SealSource = z.infer<typeof SealSourceSchema>;
export type CorpAuthConfig = z.infer<typeof CorpAuthConfigSchema>;
export type CorpConfig = z.infer<typeof CorpConfigSchema>;
