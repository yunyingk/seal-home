import { KyInstance } from "ky";
import { CorpConfig } from "../../core/config/types.js";
import {
  ApprovalDocument,
  ApprovalRule,
  ApprovalStylePreferences,
  RuleSetVersion
} from "./types.js";
import {
  getApprovalRuleVersion,
  getApprovalStylePreferences,
  listApprovalDocuments,
  listApprovalRuleVersions,
  listApprovalRules
} from "./api.js";

type MatchMode = "any" | "all";
type SearchArea = "rules" | "documents" | "preferences";
type RuleVersionScope = "current" | "all" | "version";

export type ApprovalSearchParams = {
  keywords: string[];
  matchMode?: MatchMode;
  areas?: SearchArea[];
  caseSensitive?: boolean;
  contextLines?: number;
  documentLimit?: number;
  maxResults?: number;
  refresh?: boolean;
  ruleVersionScope?: RuleVersionScope;
  ruleVersionId?: string;
  ruleVersionNumber?: number;
  latestRuleVersion?: boolean;
  snippetOnly?: boolean;
  maxChars?: number;
  fields?: string[];
};

export type ApprovalSearchResult = {
  area: SearchArea;
  entityType: "rule" | "document" | "preference" | "integration";
  entityId?: string;
  title?: string;
  field: string;
  lineNumber: number;
  matchedKeywords: string[];
  matchedText: string;
  context: {
    before: string[];
    line: string;
    after: string[];
  };
  metadata?: Record<string, unknown>;
};

type SearchEntry = {
  area: SearchArea;
  entityType: ApprovalSearchResult["entityType"];
  entityId?: string;
  title?: string;
  field: string;
  value: unknown;
  metadata?: Record<string, unknown>;
};

type SearchCacheEntry = {
  entries: SearchEntry[];
  fetchedAt: number;
  expiresAt: number;
};

const CACHE_TTL_MS = 5 * 60 * 1000;
const searchCache = new Map<string, SearchCacheEntry>();

function normalizeKeywords(keywords: string[], caseSensitive: boolean): string[] {
  return keywords
    .map((keyword) => keyword.trim())
    .filter(Boolean)
    .map((keyword) => caseSensitive ? keyword : keyword.toLowerCase());
}

function textForMatch(value: string, caseSensitive: boolean): string {
  return caseSensitive ? value : value.toLowerCase();
}

function matchedKeywords(
  value: string,
  keywords: string[],
  matchMode: MatchMode,
  caseSensitive: boolean
): string[] {
  const text = textForMatch(value, caseSensitive);
  const matches = keywords.filter((keyword) => text.includes(keyword));
  if (matchMode === "all" && matches.length !== keywords.length) return [];
  return matches;
}

function linesOf(value: unknown): string[] {
  if (typeof value === "string") return value.split(/\r?\n/);
  return JSON.stringify(value, null, 2).split(/\r?\n/);
}

function searchEntry(
  entry: SearchEntry,
  params: Required<Pick<ApprovalSearchParams, "matchMode" | "caseSensitive" | "contextLines">> & {
    keywords: string[];
    snippetOnly?: boolean;
    maxChars?: number;
    fields?: Set<string>;
  }
): ApprovalSearchResult[] {
  if (params.fields && !params.fields.has(entry.field)) return [];

  const lines = linesOf(entry.value);
  const results: ApprovalSearchResult[] = [];

  lines.forEach((line, index) => {
    const matches = matchedKeywords(
      line,
      params.keywords,
      params.matchMode,
      params.caseSensitive
    );
    if (matches.length === 0) return;

    const beforeStart = Math.max(0, index - params.contextLines);
    const afterEnd = Math.min(lines.length, index + params.contextLines + 1);

    const result: ApprovalSearchResult = {
      area: entry.area,
      entityType: entry.entityType,
      entityId: entry.entityId,
      title: entry.title,
      field: entry.field,
      lineNumber: index + 1,
      matchedKeywords: matches,
      matchedText: truncateText(line, params.maxChars),
      context: {
        before: params.snippetOnly ? [] : lines.slice(beforeStart, index).map((item) => truncateText(item, params.maxChars)),
        line: truncateText(line, params.maxChars),
        after: params.snippetOnly ? [] : lines.slice(index + 1, afterEnd).map((item) => truncateText(item, params.maxChars))
      },
      metadata: entry.metadata
    };

    if (params.snippetOnly) {
      result.context = {
        before: [],
        line: result.context.line,
        after: []
      };
    }

    results.push(result);
  });

  return results;
}

function truncateText(value: string, maxChars?: number): string {
  if (!maxChars || value.length <= maxChars) return value;
  return `${value.slice(0, Math.max(0, maxChars))}...`;
}

function ruleEntries(rule: ApprovalRule): SearchEntry[] {
  return [
    {
      area: "rules",
      entityType: "rule",
      entityId: rule.id,
      title: rule.scope,
      field: "description",
      value: rule.description,
      metadata: {
        scope: rule.scope,
        strictness: rule.strictness,
        status: rule.status
      }
    },
    {
      area: "rules",
      entityType: "rule",
      entityId: rule.id,
      title: rule.scope,
      field: "scope",
      value: rule.scope,
      metadata: {
        strictness: rule.strictness,
        status: rule.status
      }
    }
  ];
}

function ruleVersionEntries(version: RuleSetVersion): SearchEntry[] {
  return version.rules.flatMap((rule, index) => {
    const entityId = `${version.id}:${rule.description.slice(0, 32)}`;
    const metadata = {
      versionId: version.id,
      versionNumber: version.versionNumber,
      versionName: version.versionName,
      publishedByName: version.publishedByName,
      publishedAt: version.publishedAt,
      scope: rule.scope,
      strictness: rule.strictness,
      code: "code" in rule ? (rule as { code?: string }).code : undefined,
      index
    };

    return [
      {
        area: "rules" as const,
        entityType: "rule" as const,
        entityId,
        title: `${version.versionName} / ${rule.scope}`,
        field: "history.description",
        value: rule.description,
        metadata
      },
      {
        area: "rules" as const,
        entityType: "rule" as const,
        entityId,
        title: `${version.versionName} / ${rule.scope}`,
        field: "history.scope",
        value: rule.scope,
        metadata
      }
    ];
  });
}

function documentEntries(document: ApprovalDocument): SearchEntry[] {
  return [
    {
      area: "documents",
      entityType: "document",
      entityId: document.id,
      title: document.title,
      field: "title",
      value: document.title,
      metadata: {
        status: document.status,
        scenarios: document.scenarios,
        tags: document.tags
      }
    },
    {
      area: "documents",
      entityType: "document",
      entityId: document.id,
      title: document.title,
      field: "purpose",
      value: document.purpose,
      metadata: {
        status: document.status,
        scenarios: document.scenarios,
        tags: document.tags
      }
    },
    {
      area: "documents",
      entityType: "document",
      entityId: document.id,
      title: document.title,
      field: "content",
      value: document.content,
      metadata: {
        status: document.status,
        scenarios: document.scenarios,
        tags: document.tags
      }
    }
  ];
}

function preferenceEntries(preferences: ApprovalStylePreferences): SearchEntry[] {
  const entries: SearchEntry[] = [];

  if (preferences.decisionPreferences) {
    for (const [field, value] of Object.entries(preferences.decisionPreferences)) {
      entries.push({
        area: "preferences",
        entityType: "preference",
        field: `decisionPreferences.${field}`,
        value,
        metadata: {
          integrationSystem: preferences.integrationSystem
        }
      });
    }
  }

  preferences.integrations.forEach((integration, index) => {
    entries.push({
      area: "preferences",
      entityType: "integration",
      title: integration.outboundName,
      field: `integrations[${index}]`,
      value: integration,
      metadata: {
        type: integration.type,
        outboundName: integration.outboundName,
        mode: integration.mode,
        corporationId: integration.corporationId
      }
    });
  });

  return entries;
}

async function loadSearchEntries(
  client: KyInstance,
  corp: CorpConfig,
  params: Pick<ApprovalSearchParams, "documentLimit" | "refresh" | "ruleVersionScope" | "ruleVersionId" | "ruleVersionNumber" | "latestRuleVersion">
): Promise<SearchCacheEntry> {
  const ruleVersionScope = params.ruleVersionScope ?? "current";
  const cacheKey = [
    corp.id,
    `ruleVersionScope=${ruleVersionScope}`,
    `ruleVersionId=${params.ruleVersionId ?? ""}`,
    `ruleVersionNumber=${params.ruleVersionNumber ?? ""}`,
    `latestRuleVersion=${params.latestRuleVersion ?? false}`,
    `documentLimit=${params.documentLimit ?? 100}`
  ].join("|");
  const cached = searchCache.get(cacheKey);
  if (!params.refresh && cached && Date.now() < cached.expiresAt) {
    return cached;
  }

  const [rules, documents, preferences] = await Promise.all([
    loadRuleEntries(client, {
      scope: ruleVersionScope,
      versionId: params.ruleVersionId,
      versionNumber: params.ruleVersionNumber,
      latest: params.latestRuleVersion
    }),
    listApprovalDocuments(client, { limit: params.documentLimit ?? 100 }),
    getApprovalStylePreferences(
      client,
      corp.seal.endpoints.approvalStylePreferences
    )
  ]);

  const fetchedAt = Date.now();
  const next: SearchCacheEntry = {
    entries: [
      ...rules,
      ...documents.articles.flatMap(documentEntries),
      ...preferenceEntries(preferences)
    ],
    fetchedAt,
    expiresAt: fetchedAt + CACHE_TTL_MS
  };

  searchCache.set(cacheKey, next);
  return next;
}

async function loadRuleEntries(
  client: KyInstance,
  params: {
    scope: RuleVersionScope;
    versionId?: string;
    versionNumber?: number;
    latest?: boolean;
  }
): Promise<SearchEntry[]> {
  if (params.scope === "current") {
    const rules = await listApprovalRules(client);
    return rules.rules.flatMap(ruleEntries);
  }

  if (params.scope === "version") {
    const version = await resolveRuleVersion(client, params);
    return ruleVersionEntries(version);
  }

  const versions = await listApprovalRuleVersions(client);
  return versions.flatMap(ruleVersionEntries);
}

async function resolveRuleVersion(
  client: KyInstance,
  params: { versionId?: string; versionNumber?: number; latest?: boolean }
) {
  if (params.versionId) return getApprovalRuleVersion(client, params.versionId);

  const versions = await listApprovalRuleVersions(client);
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

export async function searchApprovalContent(
  client: KyInstance,
  corp: CorpConfig,
  params: ApprovalSearchParams
) {
  const matchMode = params.matchMode ?? "any";
  const caseSensitive = params.caseSensitive ?? false;
  const contextLines = params.contextLines ?? 3;
  const areas = new Set(params.areas ?? ["rules", "documents", "preferences"]);
  const maxResults = params.maxResults ?? 50;
  const ruleVersionScope = params.ruleVersionScope ?? "current";
  const keywords = normalizeKeywords(params.keywords, caseSensitive);
  const fields = params.fields?.length ? new Set(params.fields) : undefined;

  if (keywords.length === 0) {
    throw new Error("keywords must contain at least one non-empty string");
  }

  const cached = await loadSearchEntries(client, corp, {
    documentLimit: params.documentLimit,
    refresh: params.refresh,
    ruleVersionScope,
    ruleVersionId: params.ruleVersionId,
    ruleVersionNumber: params.ruleVersionNumber,
    latestRuleVersion: params.latestRuleVersion
  });

  const results = cached.entries
    .filter((entry) => areas.has(entry.area))
    .flatMap((entry) =>
      searchEntry(entry, {
        keywords,
        matchMode,
        caseSensitive,
        contextLines,
        snippetOnly: params.snippetOnly,
        maxChars: params.maxChars,
        fields
      })
    );

  return {
    query: {
      keywords: params.keywords,
      matchMode,
      areas: Array.from(areas),
      caseSensitive,
      contextLines,
      refresh: params.refresh ?? false,
      ruleVersionScope,
      ruleVersionId: params.ruleVersionId,
      ruleVersionNumber: params.ruleVersionNumber,
      latestRuleVersion: params.latestRuleVersion ?? false,
      snippetOnly: params.snippetOnly ?? false,
      maxChars: params.maxChars,
      fields: params.fields
    },
    cache: {
      fetchedAt: new Date(cached.fetchedAt).toISOString(),
      expiresAt: new Date(cached.expiresAt).toISOString(),
      ttlMs: CACHE_TTL_MS
    },
    total: results.length,
    returned: Math.min(results.length, maxResults),
    results: results.slice(0, maxResults)
  };
}
