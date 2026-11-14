import { createHash } from "node:crypto";

/**
 * Fact checking by source content. A found quote means only "the quote is on the source page",
 * not proof of the claim: the editor still reads it. Critical facts block publication until
 * their quote is found or the editor confirms them by hand with a source.
 */

export type Importance = "critical" | "normal";

/** A key statement of the article as the model reported it. */
export interface Claim {
  claim: string;
  importance: Importance;
  source_url: string;
  quote: string;
}

export type FactState = "quote_found" | "quote_not_found" | "source_unavailable" | "no_text" | "no_quote";

export interface ManualConfirmation {
  at: string;
  sourceUrl: string;
}

/**
 * One stored entry in blog_posts.fact_checks.
 * - "claim": a statement from the model with its quote and source;
 * - "sentence": a sentence with figures that no claim covers, confirmed by the editor;
 * - "no_claims": the editor confirmed the article has no key facts at all.
 */
export interface FactEntry {
  id: string;
  kind: "claim" | "sentence" | "no_claims";
  claim: string;
  importance: Importance;
  sourceUrl: string | null;
  quote: string | null;
  state: FactState | null;
  detail: string | null;
  checkedAt: string | null;
  manual: ManualConfirmation | null;
}

/** Stable id: changes whenever the statement, its quote or its source changes, which resets a manual confirmation. */
export function factId(kind: FactEntry["kind"], claim: string, quote = "", url = ""): string {
  return createHash("sha256").update(`${kind}\u0000${claim.trim()}\u0000${quote.trim()}\u0000${url.trim()}`).digest("hex").slice(0, 16);
}

/** Text normalized for quote matching: case, whitespace, quotes, dashes and Unicode forms. */
export function normalizeForMatch(text: string): string {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[­​-‍]/g, "")
    .replace(/[«»“”„"‟]/g, '"')
    .replace(/[‘’‚‛`´]/g, "'")
    .replace(/[‐‑‒–—―−]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

export const MIN_QUOTE_LENGTH = 20;

export function quoteFound(sourceText: string, quote: string): boolean {
  const needle = normalizeForMatch(quote).replace(/^["'.…\s]+|["'.…\s]+$/g, "");
  if (needle.length < MIN_QUOTE_LENGTH) return false;
  return normalizeForMatch(sourceText).includes(needle);
}

export function cleanClaims(raw: unknown): Claim[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const claims: Claim[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const claim = typeof record.claim === "string" ? record.claim.trim() : "";
    if (!claim) continue;
    const entry: Claim = {
      claim: claim.slice(0, 500),
      importance: record.importance === "normal" ? "normal" : "critical",
      source_url: typeof record.source_url === "string" ? record.source_url.trim() : "",
      quote: typeof record.quote === "string" ? record.quote.trim().slice(0, 400) : "",
    };
    const key = factId("claim", entry.claim, entry.quote, entry.source_url);
    if (seen.has(key)) continue;
    seen.add(key);
    claims.push(entry);
    if (claims.length >= 30) break;
  }
  return claims;
}

export function claimsFromEntries(entries: FactEntry[]): Claim[] {
  return entries
    .filter((entry) => entry.kind === "claim")
    .map((entry) => ({
      claim: entry.claim,
      importance: entry.importance,
      source_url: entry.sourceUrl ?? "",
      quote: entry.quote ?? "",
    }));
}

export function asFactEntries(raw: unknown): FactEntry[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const entry = item as Partial<FactEntry>;
    if (typeof entry.id !== "string" || typeof entry.claim !== "string") return [];
    if (entry.kind !== "claim" && entry.kind !== "sentence" && entry.kind !== "no_claims") return [];
    return [
      {
        id: entry.id,
        kind: entry.kind,
        claim: entry.claim,
        importance: entry.importance === "normal" ? "normal" : "critical",
        sourceUrl: entry.sourceUrl ?? null,
        quote: entry.quote ?? null,
        state: entry.state ?? null,
        detail: entry.detail ?? null,
        checkedAt: entry.checkedAt ?? null,
        manual:
          entry.manual && typeof entry.manual.at === "string" && typeof entry.manual.sourceUrl === "string"
            ? entry.manual
            : null,
      },
    ];
  });
}

/* ---------- coverage: figures in the text must be backed by a listed claim ---------- */

const NUMBER = /\d+(?:[.,]\d+)?/g;
const CURRENT_AS_OF = /по состоянию на|актуальн|as of|current as/i;

/** Sentences of the Russian body that state figures: amounts, percentages, dates, phone numbers. */
export function factSentences(bodyMd: string): string[] {
  const text = bodyMd
    .replace(/\[\[image:[^\]]+\]\]/g, " ")
    .replace(/\]\([^)]*\)/g, "]")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^\s*(?:\d+[.)]|[-*])\s+/gm, "");
  const sentences = text
    .split(/(?<=[.!?…])\s+|\n+/)
    .map((sentence) => sentence.replace(/[*_|]/g, "").replace(/\s+/g, " ").trim())
    .filter(Boolean);
  return [...new Set(sentences.filter((sentence) => /\d/.test(sentence) && !CURRENT_AS_OF.test(sentence)))];
}

function numbersIn(text: string): Set<string> {
  return new Set((text.match(NUMBER) ?? []).map((n) => n.replace(",", ".")));
}

/** Figure-bearing sentences that no claim (statement or quote) shares a number with. */
export function uncoveredSentences(bodyMd: string, claims: Claim[]): string[] {
  const claimNumbers = new Set(claims.flatMap((claim) => [...numbersIn(`${claim.claim} ${claim.quote}`)]));
  return factSentences(bodyMd).filter((sentence) => ![...numbersIn(sentence)].some((n) => claimNumbers.has(n)));
}

/* ---------- what still needs attention ---------- */

export interface FactItem {
  id: string;
  kind: FactEntry["kind"];
  claim: string;
  importance: Importance;
  sourceUrl: string | null;
  quote: string | null;
  status: FactState | "manual" | "unlisted" | "no_claims";
  detail: string | null;
  manual: ManualConfirmation | null;
  /** True when this item stops publication. */
  blocking: boolean;
}

/** Every fact item of the article with its status, computed from stored entries and the current text. */
export function factItems(entries: FactEntry[], russianBody: string): FactItem[] {
  const claimEntries = entries.filter((entry) => entry.kind === "claim");
  const manualById = new Map(entries.filter((entry) => entry.manual).map((entry) => [entry.id, entry.manual!]));
  const items: FactItem[] = claimEntries.map((entry) => {
    const manual = entry.manual;
    const status = manual ? "manual" : (entry.state ?? "no_quote");
    return {
      id: entry.id,
      kind: "claim",
      claim: entry.claim,
      importance: entry.importance,
      sourceUrl: entry.sourceUrl,
      quote: entry.quote,
      status,
      detail: entry.detail,
      manual,
      blocking: entry.importance === "critical" && status !== "quote_found" && status !== "manual",
    };
  });

  for (const sentence of uncoveredSentences(russianBody, claimsFromEntries(claimEntries))) {
    const id = factId("sentence", sentence);
    const manual = manualById.get(id) ?? null;
    items.push({
      id,
      kind: "sentence",
      claim: sentence,
      importance: "critical",
      sourceUrl: null,
      quote: null,
      status: manual ? "manual" : "unlisted",
      detail: "цифры в тексте без источника в списке фактов",
      manual,
      blocking: !manual,
    });
  }

  if (claimEntries.length === 0) {
    const id = factId("no_claims", russianBody);
    const manual = manualById.get(id) ?? null;
    items.push({
      id,
      kind: "no_claims",
      claim: "Список ключевых фактов пуст",
      importance: "critical",
      sourceUrl: null,
      quote: null,
      status: manual ? "manual" : "no_claims",
      detail: "пустой список не считается проверкой",
      manual,
      blocking: !manual,
    });
  }
  return items;
}

/** Records the editor's manual confirmation, with date and source, for one current item. */
export function confirmFact(entries: FactEntry[], item: FactItem, sourceUrl: string, at = new Date()): FactEntry[] {
  const manual = { at: at.toISOString(), sourceUrl };
  if (item.kind === "claim") {
    return entries.map((entry) => (entry.id === item.id ? { ...entry, manual } : entry));
  }
  const rest = entries.filter((entry) => entry.id !== item.id);
  return [
    ...rest,
    {
      id: item.id,
      kind: item.kind,
      claim: item.claim,
      importance: "critical",
      sourceUrl: null,
      quote: null,
      state: null,
      detail: null,
      checkedAt: null,
      manual,
    },
  ];
}

/**
 * Builds claim entries from fresh source texts. A manual confirmation survives only for a claim
 * whose statement, quote and source are unchanged (same id). Editor confirmations of uncovered
 * sentences are kept; they stop matching on their own once the sentence changes.
 */
export function evaluateClaims(
  claims: Claim[],
  texts: Map<string, { ok: true; text: string } | { ok: false; state: "source_unavailable" | "no_text"; detail: string }>,
  previous: FactEntry[],
  now = new Date(),
): FactEntry[] {
  const previousManual = new Map(previous.filter((entry) => entry.manual).map((entry) => [entry.id, entry.manual!]));
  const claimEntries = claims.map((claim): FactEntry => {
    const id = factId("claim", claim.claim, claim.quote, claim.source_url);
    let state: FactState;
    let detail: string | null = null;
    const source = texts.get(claim.source_url);
    if (!claim.quote || normalizeForMatch(claim.quote).length < MIN_QUOTE_LENGTH) {
      state = "no_quote";
      detail = "нет цитаты из источника";
    } else if (!source) {
      state = "source_unavailable";
      detail = "источник не указан или не разрешён";
    } else if (!source.ok) {
      state = source.state;
      detail = source.detail;
    } else if (quoteFound(source.text, claim.quote)) {
      state = "quote_found";
    } else {
      state = "quote_not_found";
      detail = "цитаты нет на странице источника";
    }
    return {
      id,
      kind: "claim",
      claim: claim.claim,
      importance: claim.importance,
      sourceUrl: claim.source_url || null,
      quote: claim.quote || null,
      state,
      detail,
      checkedAt: now.toISOString(),
      manual: previousManual.get(id) ?? null,
    };
  });
  const keptConfirmations = previous.filter((entry) => entry.kind !== "claim" && entry.manual);
  return [...claimEntries, ...keptConfirmations];
}
