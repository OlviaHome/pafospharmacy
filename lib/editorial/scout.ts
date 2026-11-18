import { htmlToText } from "./source-text";
import { estimateCostUsd } from "./pricing";

/**
 * Medical News Scout, the pure part: reading feeds, technical de-duplication, the collection
 * window, checking the model's selection against what was actually collected, and the cost
 * reservation. Nothing here touches the network or the database.
 *
 * Everything that comes from a feed, a page or a search is untrusted data: it is only ever shown
 * to the model as marked data and never decides what the bot does.
 */

/* ---------- feeds ---------- */

export interface FeedItem {
  title: string;
  url: string;
  summary: string;
  /** ISO timestamp, or null when the feed gives none. */
  publishedAt: string | null;
}

export const MAX_FEED_ITEMS = 60;
const TRACKING_PARAM = /^(utm_|fbclid$|gclid$|yclid$|igshid$|mc_|_ga$|ref$|ref_src$)/i;

/** The key of a publication's address: https, no fragment or tracking parameters, no trailing slash. */
export function normalizeUrl(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol === "http:") url.protocol = "https:";
  if (url.protocol !== "https:" || url.username || url.password) return null;
  url.hash = "";
  for (const key of [...url.searchParams.keys()]) if (TRACKING_PARAM.test(key)) url.searchParams.delete(key);
  url.searchParams.sort();
  const path = url.pathname.replace(/\/+$/, "");
  const query = url.search;
  return `https://${url.host.toLowerCase()}${path}${query}`;
}

/** Headlines that differ only in case, punctuation or spacing are the same headline. */
export function titleKey(title: string): string {
  return title.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

function cdata(text: string): string {
  return text.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");
}

/** Text of a feed field: entities decoded and markup removed (feeds often carry escaped HTML). */
function plain(text: string): string {
  return htmlToText(htmlToText(cdata(text))).replace(/\s+/g, " ").trim();
}

/** Addresses in XML carry escaped ampersands (&amp;). */
function unescapeAddress(text: string): string {
  return text.trim().replace(/&amp;/gi, "&");
}

function tagText(block: string, tag: string): string {
  const match = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, "i").exec(block);
  return match ? match[1] : "";
}

function atomLink(block: string): string {
  const links = [...block.matchAll(/<link\b([^>]*)>/gi)].map((match) => match[1]);
  const preferred = links.find((attrs) => !/\brel=/i.test(attrs) || /\brel=["']alternate["']/i.test(attrs)) ?? links[0] ?? "";
  return /\bhref=["']([^"']+)["']/i.exec(preferred)?.[1] ?? "";
}

function isoDate(text: string): string | null {
  const value = Date.parse(text.trim());
  return Number.isFinite(value) ? new Date(value).toISOString() : null;
}

/**
 * Items of an RSS 2.0, RSS 1.0 or Atom document. Returns null when the text is not a feed at all
 * (an HTML page, an error page), so "not a feed" and "an empty feed" stay different results.
 */
export function parseFeed(xml: string, limit = MAX_FEED_ITEMS): FeedItem[] | null {
  if (!/<(rss|feed|rdf:RDF)\b/i.test(xml)) return null;
  const blocks = [...xml.matchAll(/<(item|entry)\b[\s\S]*?<\/\1>/gi)].map((match) => match[0]);
  const items: FeedItem[] = [];
  for (const block of blocks) {
    const title = plain(tagText(block, "title"));
    const rawLink = unescapeAddress(cdata(tagText(block, "link"))) || unescapeAddress(atomLink(block));
    const guid = unescapeAddress(cdata(tagText(block, "guid")));
    const url = normalizeUrl(/^https?:\/\//i.test(rawLink) ? rawLink : /^https?:\/\//i.test(guid) ? guid : "");
    if (!title || !url) continue;
    const summary = plain(tagText(block, "description") || tagText(block, "summary") || tagText(block, "content:encoded") || tagText(block, "content"));
    const published = isoDate(cdata(tagText(block, "pubDate") || tagText(block, "published") || tagText(block, "updated") || tagText(block, "dc:date")));
    items.push({ title: title.slice(0, 400), url, summary: summary.slice(0, 600), publishedAt: published });
    if (items.length >= limit) break;
  }
  return items;
}

/** Technical duplicates: the same address or the same headline. The first (most important source) wins. */
export function dedupeItems<T extends { url: string; title: string }>(items: T[]): T[] {
  const urls = new Set<string>();
  const titles = new Set<string>();
  const kept: T[] = [];
  for (const item of items) {
    const urlKey = normalizeUrl(item.url) ?? item.url;
    const key = titleKey(item.title);
    if (urls.has(urlKey) || (key && titles.has(key))) continue;
    urls.add(urlKey);
    if (key) titles.add(key);
    kept.push(item);
  }
  return kept;
}

/* ---------- collection window ---------- */

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
/** With no earlier successful run the window is this long; the longest catch-up after missed days is 7 days. */
export const DEFAULT_WINDOW_DAYS = 3;
export const MAX_WINDOW_DAYS = 7;

/** Publications since the last successful run (with an hour of overlap), never older than a week. */
export function windowStart(lastSuccess: Date | null, now: Date): Date {
  const floor = now.getTime() - MAX_WINDOW_DAYS * DAY_MS;
  if (!lastSuccess) return new Date(now.getTime() - DEFAULT_WINDOW_DAYS * DAY_MS);
  return new Date(Math.max(floor, lastSuccess.getTime() - HOUR_MS));
}

/* ---------- selection ---------- */

export const MAX_TOPICS = 5;
export const MIN_SCORE = 2;

export interface SelectionEvent {
  title_ru: string;
  gist_ru: string;
  why_ru: string;
  score: number;
  score_reason_ru: string;
  item_ids: string[];
  matches_event_id: string;
  new_development: boolean;
}

export interface KnownEvent {
  id: string;
  status: "new" | "shown" | "skipped" | "in_work";
}

export type SelectionAction =
  | { kind: "new"; event: CleanEvent; itemIds: string[] }
  /** An existing event with a substantial new development (or one not shown yet): refreshed and back to "new". */
  | { kind: "update"; eventId: string; event: CleanEvent; itemIds: string[] }
  /** Items that belong to an existing event and add nothing: linked, nothing shown. */
  | { kind: "attach"; eventId: string; itemIds: string[] };

export interface CleanEvent {
  title: string;
  gist: string;
  why: string;
  score: number;
  scoreReason: string;
}

function clean(text: unknown, max: number): string {
  return typeof text === "string" ? text.replace(/\s+/g, " ").trim().slice(0, max) : "";
}

/**
 * Turns the model's answer into actions, trusting nothing in it: only item ids that were really
 * collected, only event ids that really exist, bounded scores and lengths, at most MAX_TOPICS.
 * An event with no valid item is dropped, and so is a new one that scores below MIN_SCORE.
 */
export function planSelection(
  raw: { events?: SelectionEvent[] } | null | undefined,
  context: { itemIds: Set<string>; known: Map<string, KnownEvent> },
): { actions: SelectionAction[]; dropped: number } {
  const actions: SelectionAction[] = [];
  let dropped = 0;
  const claimed = new Set<string>();
  for (const candidate of (Array.isArray(raw?.events) ? raw.events : []).slice(0, MAX_TOPICS * 3)) {
    const itemIds = [...new Set((Array.isArray(candidate?.item_ids) ? candidate.item_ids : []).filter((id) => context.itemIds.has(id) && !claimed.has(id)))];
    const title = clean(candidate?.title_ru, 300);
    const gist = clean(candidate?.gist_ru, 1500);
    if (itemIds.length === 0 || !title || !gist) {
      dropped += 1;
      continue;
    }
    for (const id of itemIds) claimed.add(id);
    const score = Math.min(5, Math.max(1, Math.round(Number(candidate.score) || 1)));
    const event: CleanEvent = { title, gist, why: clean(candidate.why_ru, 800), score, scoreReason: clean(candidate.score_reason_ru, 500) };
    const known = candidate.matches_event_id ? context.known.get(candidate.matches_event_id) : undefined;
    if (known) {
      if (known.status === "in_work") actions.push({ kind: "attach", eventId: known.id, itemIds });
      else if (known.status === "new" || candidate.new_development === true) actions.push({ kind: "update", eventId: known.id, event, itemIds });
      else actions.push({ kind: "attach", eventId: known.id, itemIds });
      continue;
    }
    if (score < MIN_SCORE) {
      dropped += 1;
      continue;
    }
    actions.push({ kind: "new", event, itemIds });
  }
  return { actions, dropped };
}

/** The events shown in a digest: best score first, at most MAX_TOPICS. */
export function pickDigest<T extends { score: number; firstSeenAt: string }>(events: T[]): T[] {
  return [...events]
    .filter((event) => event.score >= MIN_SCORE)
    .sort((a, b) => b.score - a.score || a.firstSeenAt.localeCompare(b.firstSeenAt))
    .slice(0, MAX_TOPICS);
}

/* ---------- limits ---------- */

/**
 * Upfront reservation for one run: the restricted official search (up to 5 searches) and the
 * selection call. Deliberately a little above a typical run, so the cap is never overshot.
 */
export function scoutReservedUsd(model: string): number {
  const search = estimateCostUsd(model, { inputTokens: 20_000, cachedInputTokens: 0, outputTokens: 4_000, webSearchCalls: 5 });
  const selection = estimateCostUsd(model, { inputTokens: 30_000, cachedInputTokens: 0, outputTokens: 6_000, webSearchCalls: 0 });
  return search + selection;
}

/** The day a run belongs to, in Cyprus time (YYYY-MM-DD). */
export function cyprusDate(now: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Nicosia", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/** A host belongs to a domain when it is the domain or one of its subdomains. */
export function hostInDomains(url: string, domains: string[]): boolean {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase().replace(/\.$/, "");
  } catch {
    return false;
  }
  return domains.some((domain) => host === domain.toLowerCase() || host.endsWith(`.${domain.toLowerCase()}`));
}
