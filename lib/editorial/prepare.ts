/**
 * /import, mode B («Без рерайта»): the editor's own text stays the text. Pure helpers, no AI.
 *
 * - splitParagraphs / assembleBody: the model returns the author's text paragraph by paragraph and
 *   the server builds the article around it (headings, «Коротко», image markers), so the author's
 *   paragraphs cannot be changed by the structuring step.
 * - compareToSource: word-by-word comparison of the article's own text with the original. Only
 *   spelling inside words, punctuation, spaces, quotes, dashes and formatting may differ; numbers,
 *   dates, phones, addresses and links never.
 * - pairsProblems: a translation that goes paragraph by paragraph against the original.
 */

import { createHash } from "node:crypto";

export interface Token {
  /** As written, for showing to the editor. */
  raw: string;
  /** Lower case, ё → е: what is compared. */
  norm: string;
}

const TOKEN = /https?:\/\/[^\s)\]>»”"]+|\p{N}+(?:[.,:/\-'’]\p{N}+)*|[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu;

function trimUrl(url: string): string {
  return url.replace(/[.,;:!?]+$/, "");
}

/** Markdown marks that are formatting, not words. */
function stripFormatting(text: string): string {
  return text
    .replace(/\[\[image:[^\]]+\]\]/g, " ")
    .replace(/\]\((https?:\/\/[^)\s]+)\)/g, "] $1 ")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s*(?:[-*•]|\d+[.)])\s+/gm, "")
    .replace(/[*_`>|]/g, " ");
}

export function tokens(text: string): Token[] {
  return [...stripFormatting(text).matchAll(TOKEN)].map((match) => {
    const raw = /^https?:/.test(match[0]) ? trimUrl(match[0]) : match[0];
    return { raw, norm: raw.toLowerCase().replace(/ё/g, "е") };
  });
}

const hasDigit = (value: string) => /\p{N}/u.test(value);
const isUrl = (value: string) => /^https?:/.test(value);

function distance(a: string, b: string, limit: number): number {
  if (Math.abs(a.length - b.length) > limit) return limit + 1;
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) {
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    previous = current;
  }
  return previous[b.length];
}

/** Two words are the same word: equal, or (when `tolerant`) one spelling fix apart. Numbers and links never. */
export function sameToken(a: string, b: string, tolerant: boolean): boolean {
  if (a === b) return true;
  if (!tolerant || hasDigit(a) || hasDigit(b) || isUrl(a) || isUrl(b)) return false;
  const shortest = Math.min(a.length, b.length);
  if (shortest < 5) return false;
  return distance(a, b, 2) <= (shortest >= 9 ? 2 : 1);
}

export interface Hunk {
  /** The original's words that are missing or different. */
  before: string;
  /** The article's words in their place. */
  after: string;
  /** Index in the original's word list, for ordering. */
  at: number;
}

const WINDOW = 60;
const ANCHOR = 3;

/**
 * Word-level comparison: the hunks where the article's words differ from the original's. Two
 * original words written as one (and the reverse) count as a spacing fix.
 */
export function diffTokens(source: Token[], article: Token[], tolerant: boolean): Hunk[] {
  const hunks: Hunk[] = [];
  const same = (i: number, j: number) => i < source.length && j < article.length && sameToken(source[i].norm, article[j].norm, tolerant);
  const anchored = (i: number, j: number) => {
    const length = Math.min(ANCHOR, source.length - i, article.length - j);
    if (length <= 0) return source.length - i === 0 && article.length - j === 0;
    for (let k = 0; k < length; k += 1) if (!same(i + k, j + k)) return false;
    return true;
  };
  let i = 0;
  let j = 0;
  while (i < source.length || j < article.length) {
    if (same(i, j)) {
      i += 1;
      j += 1;
      continue;
    }
    // Spacing: «по этому» ↔ «поэтому».
    if (i + 1 < source.length && j < article.length && sameToken(source[i].norm + source[i + 1].norm, article[j].norm, tolerant) && !hasDigit(article[j].norm)) {
      i += 2;
      j += 1;
      continue;
    }
    if (j + 1 < article.length && i < source.length && sameToken(article[j].norm + article[j + 1].norm, source[i].norm, tolerant) && !hasDigit(source[i].norm)) {
      i += 1;
      j += 2;
      continue;
    }
    let found: [number, number] | null = null;
    for (let total = 1; total <= WINDOW * 2 && !found; total += 1) {
      for (let di = 0; di <= Math.min(total, WINDOW); di += 1) {
        const dj = total - di;
        if (dj > WINDOW) continue;
        if (i + di > source.length || j + dj > article.length) continue;
        if (di === 0 && dj === 0) continue;
        if (anchored(i + di, j + dj)) {
          found = [di, dj];
          break;
        }
      }
    }
    const [di, dj] = found ?? [source.length - i, article.length - j];
    hunks.push({
      before: source.slice(i, i + di).map((t) => t.raw).join(" "),
      after: article.slice(j, j + dj).map((t) => t.raw).join(" "),
      at: i,
    });
    i += di;
    j += dj;
  }
  return hunks;
}

/* ---------- paragraphs and the assembled article ---------- */

export function splitParagraphs(text: string): string[] {
  return text
    .replace(/\r\n/g, "\n")
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
}

export interface AssemblyPlan {
  paragraphs: string[];
  /** Heading text (no #) placed before the paragraph with this index. */
  headings: { before: number; text: string }[];
  short_points: string[];
  /** Inline image markers placed after the paragraph with this index. */
  inline_images: { slot: string; after: number }[];
}

export const SHORT_HEADING = "Коротко";

/** The article body: «Коротко», then the author's paragraphs in order with added headings and image markers. */
export function assembleBody(plan: AssemblyPlan): string {
  const parts: string[] = [];
  const points = plan.short_points.map((point) => point.trim()).filter(Boolean).slice(0, 3);
  parts.push(`## ${SHORT_HEADING}\n\n${points.map((point) => `- ${point}`).join("\n")}`);
  plan.paragraphs.forEach((paragraph, index) => {
    for (const heading of plan.headings.filter((candidate) => candidate.before === index)) {
      const text = heading.text.replace(/^#+\s*/, "").trim();
      if (text) parts.push(`## ${text}`);
    }
    parts.push(paragraph);
    for (const image of plan.inline_images.filter((candidate) => candidate.after === index)) parts.push(`[[image:${image.slot}]]`);
  });
  return parts.join("\n\n");
}

/** The article's own text: the body without «Коротко», added headings and image markers. */
export function mainTextOf(bodyMd: string, originalText: string): string {
  const original = tokens(originalText).map((t) => t.norm).join(" ");
  const lines = bodyMd.replace(/\r\n/g, "\n").split("\n");
  const kept: string[] = [];
  let inShort = false;
  for (const line of lines) {
    const heading = /^\s{0,3}#{1,6}\s+(.*)$/.exec(line);
    if (heading) {
      const words = tokens(heading[1]).map((t) => t.norm).join(" ");
      inShort = new RegExp(`^${SHORT_HEADING.toLowerCase()}$`).test(words);
      // A heading that is the author's own line stays; one the bot added does not.
      if (!inShort && words && ` ${original} `.includes(` ${words} `)) kept.push(line);
      continue;
    }
    // «Коротко» is its heading and the bullets right under it; the author's text starts after them.
    if (inShort) {
      if (!line.trim() || /^\s*(?:[-*•]|\d+[.)])\s/.test(line)) continue;
      inShort = false;
    }
    if (/^\s*\[\[image:[^\]]+\]\]\s*$/.test(line)) continue;
    kept.push(line);
  }
  return kept.join("\n");
}

/** A short fingerprint of the words of a text; changes whenever a word changes. */
export function textHash(text: string): string {
  return createHash("sha256").update(tokens(text).map((t) => t.norm).join(" ")).digest("hex").slice(0, 16);
}

export interface ParagraphVerdict {
  ok: boolean;
  hunks: Hunk[];
}

/** One returned paragraph against its original: only spelling, punctuation, spacing, quotes, dashes, formatting. */
export function checkParagraph(original: string, corrected: string): ParagraphVerdict {
  const hunks = diffTokens(tokens(original), tokens(corrected), true);
  return { ok: hunks.length === 0, hunks };
}

/* ---------- suggestions ---------- */

export interface Suggestion {
  id: string;
  /** Verbatim fragment of the Russian body. */
  before: string;
  after: string;
  reason: string;
  status: "pending" | "accepted" | "rejected";
}

const norm = (text: string) => tokens(text).map((t) => t.norm).join(" ");

/** A difference from the original that an accepted suggestion explains. */
export function explainedByAccepted(hunk: Hunk, suggestions: Suggestion[]): boolean {
  const accepted = suggestions.filter((suggestion) => suggestion.status === "accepted");
  const after = norm(hunk.after);
  const before = norm(hunk.before);
  return accepted.some((suggestion) =>
    after ? ` ${norm(suggestion.after)} `.includes(` ${after} `) : before ? ` ${norm(suggestion.before)} `.includes(` ${before} `) : false,
  );
}

/** Replaces the suggestion's fragment in the body, once. Null when the fragment is no longer there exactly once. */
export function applySuggestion(body: string, suggestion: Pick<Suggestion, "before" | "after">): string | null {
  if (!suggestion.before) return null;
  const first = body.indexOf(suggestion.before);
  if (first < 0 || body.indexOf(suggestion.before, first + 1) >= 0) return null;
  return body.slice(0, first) + suggestion.after + body.slice(first + suggestion.before.length);
}

/* ---------- translation pairs ---------- */

export interface Pair {
  /** Original paragraph. */
  o: string;
  /** Its Russian translation. */
  t: string;
}

const numbersOf = (text: string): string[] =>
  tokens(text)
    .map((token) => token.norm)
    .filter((value) => hasDigit(value) && !isUrl(value))
    .map((value) => value.replace(/(?<=\d)[.,:/\-'’](?=\d)/g, ""))
    .sort();

const urlsOf = (text: string): string[] => [...new Set(tokens(text).map((t) => t.norm).filter(isUrl))].sort();

/** Latin-script names and abbreviations of the original (GeSY, COVID-19, mRNA). */
const latinNamesOf = (text: string): string[] =>
  [...new Set((text.match(/\b[A-Za-z]*[A-Z][A-Za-z]*[A-Z][A-Za-z0-9-]*\b|\b[A-Z][a-z]+[A-Z]\w*\b/g) ?? []).map((value) => value.toLowerCase()))].sort();

export interface PairProblem {
  index: number;
  /** Blocking problems stop publication; the others only need the editor's confirmation. */
  blocking: boolean;
  text: string;
}

const MIN_RATIO = 0.5;
const MAX_RATIO = 2.6;

/** Without AI: every paragraph present, numbers, dates, phones and links the same, a sensible length. */
export function pairsProblems(pairs: Pair[]): PairProblem[] {
  const problems: PairProblem[] = [];
  pairs.forEach((pair, index) => {
    const n = index + 1;
    if (!pair.t.trim()) {
      problems.push({ index, blocking: true, text: `Абзац ${n}: перевода нет` });
      return;
    }
    const before = numbersOf(pair.o);
    const after = numbersOf(pair.t);
    if (before.join(" ") !== after.join(" ")) {
      const lost = before.filter((value) => !after.includes(value));
      const extra = after.filter((value) => !before.includes(value));
      problems.push({
        index,
        blocking: true,
        text: `Абзац ${n}: числа, даты или телефоны не совпадают${lost.length ? ` (нет: ${lost.slice(0, 4).join(", ")})` : ""}${extra.length ? ` (лишние: ${extra.slice(0, 4).join(", ")})` : ""}`,
      });
    }
    if (urlsOf(pair.o).join(" ") !== urlsOf(pair.t).join(" ")) {
      problems.push({ index, blocking: true, text: `Абзац ${n}: ссылки не совпадают` });
    }
    if (pair.o.length >= 40) {
      const ratio = pair.t.length / pair.o.length;
      if (ratio < MIN_RATIO || ratio > MAX_RATIO) {
        problems.push({ index, blocking: true, text: `Абзац ${n}: длина перевода (${Math.round(ratio * 100)}% от оригинала) вызывает сомнение` });
      }
    }
    const names = latinNamesOf(pair.o).filter((name) => !pair.t.toLowerCase().includes(name));
    if (names.length) {
      problems.push({ index, blocking: false, text: `Абзац ${n}: в переводе нет названий латиницей: ${names.slice(0, 4).join(", ")} (проверьте, переведены ли они верно)` });
    }
  });
  return problems;
}

/** The pairs as the editor reads them: the original paragraph, then its translation. */
export function formatPairs(pairs: Pair[]): string {
  return pairs.map((pair, index) => `${index + 1}. ОРИГИНАЛ:\n${pair.o}\n\nПЕРЕВОД:\n${pair.t}`).join("\n\n———\n\n");
}
