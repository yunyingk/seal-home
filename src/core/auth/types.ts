import { z } from "zod";

export const TokenEntrySchema = z.object({
  token: z.string(),
  expiresAt: z.number()
});

export const SealEnterpriseConfigSchema = z.object({
  provider: z.string(),
  corpId: z.string().optional(),
  staffId: z.string(),
  sealUrl: z.string().url(),
  tenantId: z.string().optional(),
  tenantSlug: z.string().optional(),
  tenantName: z.string().optional(),
  raw: z.unknown().optional()
});

export const SealSessionSchema = z.object({
  token: z.string(),
  expiresAt: z.number(),
  enterprise: SealEnterpriseConfigSchema
});

export const HoseAuthCacheSchema = z.object({
  openapi: TokenEntrySchema.optional(),
  closeapi: TokenEntrySchema.optional()
});

export const CorpTokenCacheSchema = z.object({
  seal: SealSessionSchema.optional(),
  hose: HoseAuthCacheSchema.optional()
});

export const TokenStoreSchema = z.record(z.string(), CorpTokenCacheSchema);

export type TokenEntry = z.infer<typeof TokenEntrySchema>;
export type SealEnterpriseConfig = z.infer<typeof SealEnterpriseConfigSchema>;
export type SealSession = z.infer<typeof SealSessionSchema>;
export type HoseAuthCache = z.infer<typeof HoseAuthCacheSchema>;
export type CorpTokenCache = z.infer<typeof CorpTokenCacheSchema>;
export type TokenStore = z.infer<typeof TokenStoreSchema>;
