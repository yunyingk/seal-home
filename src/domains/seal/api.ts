import { KyInstance } from "ky";
import { z } from "zod";
import {
  ApprovalDocumentListData,
  ApprovalDocumentListDataSchema,
  ApprovalDocumentSchema,
  ApprovalRulesData,
  ApprovalRulesDataSchema,
  ApprovalRule,
  ApprovalRuleSchema,
  ApprovalStylePreferences,
  ApprovalStylePreferencesSchema,
  MeData,
  MeDataSchema,
  PublishVersionDataSchema,
  SealSessionData,
  SealSessionDataSchema,
  RuleSetVersion,
  RuleSetVersionSchema
} from "./types.js";

async function unwrap<T>(response: Response, schema: z.ZodType<T>): Promise<T> {
  const json = (await response.json()) as { data?: unknown };
  return schema.parse(json.data ?? json);
}

export async function getMe(client: KyInstance): Promise<MeData> {
  return unwrap(await client.get("api/v1/auth/me"), MeDataSchema);
}

export async function getSession(client: KyInstance): Promise<SealSessionData> {
  return unwrap(await client.get("api/auth/get-session"), SealSessionDataSchema);
}

export async function listApprovalRules(client: KyInstance): Promise<ApprovalRulesData> {
  return unwrap(await client.get("api/v1/rules"), ApprovalRulesDataSchema);
}

export async function createApprovalRule(
  client: KyInstance,
  params: { description: string; scope: string; strictness: string }
): Promise<ApprovalRule> {
  return unwrap(await client.post("api/v1/rules", { json: params }), ApprovalRuleSchema);
}

export async function updateApprovalRule(
  client: KyInstance,
  ruleId: string,
  params: { description?: string; scope?: string; strictness?: string }
): Promise<ApprovalRule> {
  return unwrap(await client.put(`api/v1/rules/${ruleId}`, { json: params }), ApprovalRuleSchema);
}

export async function deleteApprovalRule(client: KyInstance, ruleId: string): Promise<void> {
  await client.delete(`api/v1/rules/${ruleId}`);
}

export async function listApprovalRuleVersions(client: KyInstance): Promise<RuleSetVersion[]> {
  return unwrap(await client.get("api/v1/rule-set-versions"), z.array(RuleSetVersionSchema));
}

export async function getApprovalRuleVersion(
  client: KyInstance,
  versionId: string
): Promise<RuleSetVersion> {
  return unwrap(
    await client.get(`api/v1/rule-set-versions/${versionId}`),
    RuleSetVersionSchema
  );
}

export async function publishApprovalRuleVersion(
  client: KyInstance,
  versionName: string
): Promise<z.infer<typeof PublishVersionDataSchema>> {
  return unwrap(
    await client.post("api/v1/rule-set-versions/publish", { json: { versionName } }),
    PublishVersionDataSchema
  );
}

export async function listApprovalDocuments(
  client: KyInstance,
  params: {
    scenarios?: string[];
    offset?: number;
    limit?: number;
    sortBy?: string;
    sortOrder?: string;
  } = {}
): Promise<ApprovalDocumentListData> {
  const searchParams = new URLSearchParams();
  searchParams.set("offset", String(params.offset ?? 0));
  searchParams.set("limit", String(params.limit ?? 20));
  searchParams.set("sortBy", params.sortBy ?? "createdAt");
  searchParams.set("sortOrder", params.sortOrder ?? "desc");

  params.scenarios?.forEach((scenario, index) => {
    searchParams.set(`filter[scenarios][${index}]`, scenario);
  });

  return unwrap(
    await client.get("api/v1/knowledge/articles", { searchParams }),
    ApprovalDocumentListDataSchema
  );
}

export async function getApprovalDocument(client: KyInstance, documentId: string) {
  return unwrap(
    await client.get(`api/v1/knowledge/articles/${documentId}`),
    ApprovalDocumentSchema
  );
}

export async function createApprovalDocument(
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
) {
  return unwrap(
    await client.post("api/v1/knowledge/articles", {
      json: {
        ...params,
        contentType: params.contentType ?? "policy",
        status: params.status ?? "published",
        scenarios: params.scenarios ?? [],
        tags: params.tags ?? []
      }
    }),
    ApprovalDocumentSchema
  );
}

export async function updateApprovalDocument(
  client: KyInstance,
  documentId: string,
  params: {
    title?: string;
    purpose?: string;
    content?: string;
    contentType?: string;
    status?: string;
    enabled?: boolean;
    scenarios?: string[];
    tags?: string[];
  }
) {
  const attributes = Object.fromEntries(
    Object.entries(params).filter(([, value]) => value !== undefined)
  );

  return unwrap(
    await client.patch(`api/v1/knowledge/articles/${documentId}`, {
      json: { attributes }
    }),
    ApprovalDocumentSchema
  );
}

export async function getApprovalStylePreferences(
  client: KyInstance,
  endpoint = "api/v1/agent/ai-approval/config"
): Promise<ApprovalStylePreferences> {
  return unwrap(
    await client.get(endpoint),
    ApprovalStylePreferencesSchema
  );
}

export async function updateApprovalStylePreferences(
  client: KyInstance,
  params: Record<string, unknown>,
  endpoint = "api/v1/agent/ai-approval/config"
): Promise<ApprovalStylePreferences> {
  return unwrap(
    await client.patch(endpoint, { json: params }),
    ApprovalStylePreferencesSchema
  );
}

export async function getApprovalContext(
  client: KyInstance,
  params: {
    documentLimit?: number;
    stylePreferencesEndpoint?: string;
  } = {}
) {
  const [rules, documents, stylePreferences] = await Promise.all([
    listApprovalRules(client),
    listApprovalDocuments(client, { limit: params.documentLimit ?? 50 }),
    getApprovalStylePreferences(
      client,
      params.stylePreferencesEndpoint
    ).then(
      (data) => ({ ok: true as const, data }),
      (error) => ({
        ok: false as const,
        error: error instanceof Error ? error.message : String(error)
      })
    )
  ]);

  return {
    rules,
    documents,
    stylePreferences
  };
}
