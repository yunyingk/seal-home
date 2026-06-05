import { KyInstance } from "ky";
import { CorpConfig } from "../../core/config/types.js";
import {
  ApprovalDocument,
  ApprovalRule,
  ApprovalStylePreferences
} from "./types.js";
import {
  getApprovalStylePreferences,
  listApprovalDocuments,
  listApprovalRules
} from "./api.js";

type MatchMode = "any" | "all";
type SearchArea = "rules" | "documents" | "preferences";

export type ApprovalSearchParams = {
  keywords: string[];
  matchMode?: MatchMode;
  areas?: SearchArea[];
  caseSensitive?: boolean;
  contextLines?: number;
  documentLimit?: number;
  maxResults?: number;
  refresh?: boolean;
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
  }
): ApprovalSearchResult[] {
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

    results.push({
      area: entry.area,
      entityType: entry.entityType,
      entityId: entry.entityId,
      title: entry.title,
      field: entry.field,
      lineNumber: index + 1,
      matchedKeywords: matches,
      matchedText: line,
      context: {
        before: lines.slice(beforeStart, index),
        line,
        after: lines.slice(index + 1, afterEnd)
      },
      metadata: entry.metadata
    });
  });

  return results;
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
  params: Pick<ApprovalSearchParams, "documentLimit" | "refresh">
): Promise<SearchCacheEntry> {
  const cached = searchCache.get(corp.id);
  if (!params.refresh && cached && Date.now() < cached.expiresAt) {
    return cached;
  }

  const [rules, documents, preferences] = await Promise.all([
    listApprovalRules(client),
    listApprovalDocuments(client, { limit: params.documentLimit ?? 100 }),
    getApprovalStylePreferences(
      client,
      corp.seal.endpoints.approvalStylePreferences
    )
  ]);

  const fetchedAt = Date.now();
  const next: SearchCacheEntry = {
    entries: [
      ...rules.rules.flatMap(ruleEntries),
      ...documents.articles.flatMap(documentEntries),
      ...preferenceEntries(preferences)
    ],
    fetchedAt,
    expiresAt: fetchedAt + CACHE_TTL_MS
  };

  searchCache.set(corp.id, next);
  return next;
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
  const keywords = normalizeKeywords(params.keywords, caseSensitive);

  if (keywords.length === 0) {
    throw new Error("keywords must contain at least one non-empty string");
  }

  const cached = await loadSearchEntries(client, corp, {
    documentLimit: params.documentLimit,
    refresh: params.refresh
  });

  const results = cached.entries
    .filter((entry) => areas.has(entry.area))
    .flatMap((entry) =>
      searchEntry(entry, { keywords, matchMode, caseSensitive, contextLines })
    );

  return {
    query: {
      keywords: params.keywords,
      matchMode,
      areas: Array.from(areas),
      caseSensitive,
      contextLines,
      refresh: params.refresh ?? false
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
