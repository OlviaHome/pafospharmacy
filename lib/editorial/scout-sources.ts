import "server-only";

import { hostInDomains, normalizeUrl, parseFeed, type FeedItem } from "./scout";
import type { OfficialSearchResult } from "./scout-prompts";
import type { NewsSource, SourceCheckState } from "./scout-store";
import { safeFetch, SafeFetchError } from "./safe-fetch";
import { readLimited } from "./source-text";

/**
 * Reading the Scout's sources. Every address is requested through safeFetch (public https only,
 * checked redirects). A failing source is a result, never an exception: one source down must not
 * stop the run. Only short error codes leave this module (they go to the logs and to /sources).
 */

const USER_AGENT = "Mozilla/5.0 (compatible; HealthGuideCyprusScout/1.0; +https://healthguide.cy)";
export const FEED_TIMEOUT_MS = 10_000;
const MAX_FEED_BYTES = 2 * 1024 * 1024;

/** A request for one address; tests replace it, production uses safeFetch. */
export type Fetcher = (url: string) => Promise<Response>;

export const defaultFetcher: Fetcher = (url) =>
  safeFetch(url, {
    headers: {
      "User-Agent": USER_AGENT,
      Accept: "application/rss+xml, application/atom+xml, application/xml;q=0.9, text/xml;q=0.8, text/html;q=0.5, */*;q=0.3",
    },
    timeoutMs: FEED_TIMEOUT_MS,
  });

type Failure = { ok: false; state: Exclude<SourceCheckState, "ok" | "empty" | "search">; code: string };

function failureOf(error: unknown): Failure {
  const reason = error instanceof SafeFetchError ? error.reason : "network";
  return { ok: false, state: "unreachable", code: reason };
}

function statusFailure(status: number): Failure {
  return { ok: false, state: status === 401 || status === 403 || status === 429 ? "blocked" : "unreachable", code: `http_${status}` };
}

export type FeedRead = { ok: true; items: FeedItem[] } | Failure;

export async function readFeed(url: string, fetcher: Fetcher = defaultFetcher): Promise<FeedRead> {
  let response: Response;
  try {
    response = await fetcher(url);
  } catch (error) {
    return failureOf(error);
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    return statusFailure(response.status);
  }
  let bytes: Uint8Array | null;
  try {
    bytes = await readLimited(response, MAX_FEED_BYTES);
  } catch {
    return { ok: false, state: "unreachable", code: "timeout" };
  }
  if (!bytes) return { ok: false, state: "unreachable", code: "too_large" };
  const items = parseFeed(new TextDecoder("utf-8").decode(bytes));
  if (!items) return { ok: false, state: "not_feed", code: "not_feed" };
  return { ok: true, items };
}

export interface SourceCheckResult {
  state: SourceCheckState;
  detail: string;
}

const STATE_TEXT: Record<Exclude<SourceCheckState, "ok" | "empty" | "search">, string> = {
  blocked: "сайт не пускает автоматические запросы",
  unreachable: "не открывается",
  not_feed: "по этому адресу не лента новостей",
};

/**
 * Access check made from the server function. A feed: opened and parsed. A domain read through
 * search: only whether its front page opens, for information (a refusal is expected for gov.cy,
 * which is exactly why such sites are covered by search).
 */
export async function checkSource(source: Pick<NewsSource, "kind" | "url">, fetcher: Fetcher = defaultFetcher): Promise<SourceCheckResult> {
  if (source.kind === "search") {
    let response: Response;
    try {
      response = await fetcher(`https://${source.url}/`);
    } catch (error) {
      return { state: "search", detail: `поиск по домену; главная не открывается (${failureOf(error).code})` };
    }
    await response.body?.cancel().catch(() => undefined);
    return {
      state: "search",
      detail: response.ok ? "поиск по домену; главная открывается" : `поиск по домену; главная отвечает HTTP ${response.status}, читается только через поиск`,
    };
  }
  const read = await readFeed(source.url, fetcher);
  if (!read.ok) return { state: read.state, detail: `${STATE_TEXT[read.state]} (${read.code})` };
  return read.items.length === 0 ? { state: "empty", detail: "лента открылась, но пустая" } : { state: "ok", detail: `публикаций в ленте: ${read.items.length}` };
}

/* ---------- the restricted search of official sites ---------- */

export interface CollectedItem {
  sourceId: string | null;
  url: string;
  title: string;
  summary: string;
  publishedAt: string | null;
}

/**
 * Items from the official search, trusted only as far as they check out: an address on one of the
 * searched domains, https, a headline. The matching source row is the one with the longest domain.
 */
export function acceptOfficialItems(
  result: OfficialSearchResult | null | undefined,
  searchSources: Pick<NewsSource, "id" | "url">[],
): CollectedItem[] {
  const domains = searchSources.map((source) => source.url);
  const items: CollectedItem[] = [];
  for (const raw of Array.isArray(result?.items) ? result.items : []) {
    const url = typeof raw?.url === "string" ? normalizeUrl(raw.url) : null;
    const title = typeof raw?.title === "string" ? raw.title.replace(/\s+/g, " ").trim() : "";
    if (!url || !title || !hostInDomains(url, domains)) continue;
    const published = typeof raw.published === "string" && /^\d{4}-\d{2}-\d{2}/.test(raw.published) ? Date.parse(raw.published) : NaN;
    const source = searchSources
      .filter((candidate) => hostInDomains(url, [candidate.url]))
      .sort((a, b) => b.url.length - a.url.length)[0];
    items.push({
      sourceId: source?.id ?? null,
      url,
      title: title.slice(0, 400),
      summary: typeof raw.summary === "string" ? raw.summary.replace(/\s+/g, " ").trim().slice(0, 600) : "",
      publishedAt: Number.isFinite(published) ? new Date(published).toISOString() : null,
    });
  }
  return items;
}
