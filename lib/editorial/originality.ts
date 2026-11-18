/**
 * Is an article written from imported material independent of it? Pure text comparison, no AI.
 *
 * Two measures, each blocking on its own:
 * 1. Shared wording: runs of words the article has in common with the material (or, for a
 *    non-Russian material, with its working Russian translation). Words are compared by stem, so
 *    a copied sentence with changed endings still counts.
 * 2. Followed structure: most article paragraphs restate material paragraphs in the same order.
 *    This also catches a close translation, whose words differ from the working translation's.
 *
 * Not counted: text inside quotation marks or a blockquote up to MAX_QUOTE_WORDS words (a quote),
 * and runs made mostly of capitalised words (names of organisations, official terms).
 */

export const ORIGINALITY = {
  /** Words compared as one unit; shorter runs are ordinary phrases. */
  shingle: 6,
  /** A shared run this long (in words) blocks: it is a copied sentence. */
  maxSharedRun: 15,
  /** This share of the article's words inside shared runs blocks. */
  maxSharedShare: 0.07,
  /** Stem length for the paragraph comparison: shorter than for wording, so a re-translation still matches. */
  paragraphStem: 5,
  /** A paragraph "restates" a material paragraph when this share of its content stems is there. */
  paragraphMatch: 0.33,
  /** Blocking: this many consecutive paragraphs in the material's order… */
  orderRun: 3,
  /** …and they make up this share of the article's paragraphs. */
  orderShare: 0.5,
  maxQuoteWords: 40,
} as const;

export interface OriginalityResult {
  longestRun: number;
  sharedShare: number;
  orderRun: number;
  orderShare: number;
  /** Shared runs, longest first, for the editor (at most 5). */
  fragments: string[];
  blocked: boolean;
  reasons: string[];
}

interface Token {
  stem: string;
  /** Inside a quote: never part of a shared run. */
  quoted: boolean;
  capital: boolean;
  raw: string;
}

const WORD = /[\p{L}\p{N}]+(?:[-’'][\p{L}\p{N}]+)*/gu;

/** Common short words that carry no content; they are skipped in the paragraph comparison. */
const STOP = new Set([
  "и", "в", "во", "на", "с", "со", "по", "к", "ко", "о", "об", "от", "до", "из", "за", "для", "не", "что", "это",
  "как", "а", "но", "или", "же", "ли", "бы", "то", "его", "ее", "их", "он", "она", "они", "мы", "вы", "так", "при",
  "the", "a", "an", "and", "or", "of", "to", "in", "on", "for", "with", "by", "is", "are", "be", "will", "that", "this",
  "from", "at", "as", "it", "its",
]);

function stem(word: string, length = 6): string {
  const lower = word.toLowerCase().replace(/ё/g, "е");
  return lower.length > length ? lower.slice(0, length) : lower;
}

/** Markdown to plain text: no links, image markers, headings marks, list marks or emphasis. */
function plain(markdown: string): string {
  return markdown
    .replace(/\[\[image:[^\]]+\]\]/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^\s*(?:\d+[.)]|[-*])\s+/gm, "")
    .replace(/[*_`|]/g, " ");
}

/** Quote spans: «…», “…”, "…" and blockquote lines, each up to maxQuoteWords words. */
function quotedRanges(text: string): [number, number][] {
  const ranges: [number, number][] = [];
  for (const match of text.matchAll(/«[^»]*»|“[^”]*”|"[^"\n]*"|^>.*$/gm)) {
    const words = match[0].match(WORD)?.length ?? 0;
    if (words <= ORIGINALITY.maxQuoteWords) ranges.push([match.index!, match.index! + match[0].length]);
  }
  return ranges;
}

function tokens(markdown: string, withQuotes: boolean): Token[] {
  const text = plain(markdown);
  const quotes = withQuotes ? quotedRanges(text) : [];
  const result: Token[] = [];
  for (const match of text.matchAll(WORD)) {
    const at = match.index!;
    result.push({
      stem: stem(match[0]),
      quoted: quotes.some(([from, to]) => at >= from && at < to),
      capital: /^\p{Lu}/u.test(match[0]),
      raw: match[0],
    });
  }
  return result;
}

function shingles(list: Token[], size: number): Set<string> {
  const set = new Set<string>();
  for (let i = 0; i + size <= list.length; i += 1) set.add(list.slice(i, i + size).map((t) => t.stem).join(" "));
  return set;
}

interface Run {
  from: number;
  to: number;
}

/** Runs of article words that also appear, in the same order, in the material. */
function sharedRuns(article: Token[], sources: Set<string>[], size: number): Run[] {
  const hit: boolean[] = [];
  for (let i = 0; i + size <= article.length; i += 1) {
    const window = article.slice(i, i + size);
    if (window.some((t) => t.quoted)) continue;
    const key = window.map((t) => t.stem).join(" ");
    if (sources.some((set) => set.has(key))) for (let j = i; j < i + size; j += 1) hit[j] = true;
  }
  const runs: Run[] = [];
  let start = -1;
  for (let i = 0; i <= article.length; i += 1) {
    if (hit[i] && start < 0) start = i;
    if (!hit[i] && start >= 0) {
      runs.push({ from: start, to: i });
      start = -1;
    }
  }
  // Names and official terms: a run made mostly of capitalised words is not copied prose.
  return runs.filter((run) => {
    const words = article.slice(run.from, run.to);
    return words.filter((t) => t.capital).length / words.length < 0.5;
  });
}

function paragraphs(markdown: string): string[] {
  return markdown
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => !/^#{1,6}\s/.test(p) && !/^\[\[image:/.test(p) && (p.match(WORD)?.length ?? 0) >= 12);
}

function contentStems(text: string): Set<string> {
  return new Set(
    (plain(text).match(WORD) ?? [])
      .filter((w) => w.length > 3 && !STOP.has(w.toLowerCase()))
      .map((w) => stem(w, ORIGINALITY.paragraphStem)),
  );
}

/** Longest run of consecutive article paragraphs that restate material paragraphs in increasing order. */
function followedOrder(articleMd: string, sourceText: string): { run: number; share: number } {
  const own = paragraphs(articleMd);
  const theirs = paragraphs(sourceText).map(contentStems);
  if (own.length === 0 || theirs.length === 0) return { run: 0, share: 0 };
  const matched = own.map((p) => {
    const stems = contentStems(p);
    if (stems.size === 0) return -1;
    let best = -1;
    let bestScore = 0;
    theirs.forEach((source, index) => {
      const score = [...stems].filter((s) => source.has(s)).length / stems.size;
      if (score > bestScore) {
        bestScore = score;
        best = index;
      }
    });
    return bestScore >= ORIGINALITY.paragraphMatch ? best : -1;
  });
  let longest = 0;
  let current = 0;
  let previous = -1;
  for (const index of matched) {
    if (index < 0) {
      current = 0;
      previous = -1;
      continue;
    }
    current = current > 0 && index > previous ? current + 1 : 1;
    previous = index;
    longest = Math.max(longest, current);
  }
  return { run: longest, share: longest / own.length };
}

/**
 * Compares the Russian article (body and FAQ answers) with the material. `materials` holds the
 * original text and, for a non-Russian original, its working Russian translation.
 */
export function checkOriginality(articleMd: string, materials: string[]): OriginalityResult {
  const sources = materials.filter((text) => text.trim().length > 0);
  const article = tokens(articleMd, true);
  if (sources.length === 0 || article.length === 0) {
    return { longestRun: 0, sharedShare: 0, orderRun: 0, orderShare: 0, fragments: [], blocked: false, reasons: [] };
  }
  const sets = sources.map((text) => shingles(tokens(text, false), ORIGINALITY.shingle));
  const runs = sharedRuns(article, sets, ORIGINALITY.shingle).sort((a, b) => b.to - b.from - (a.to - a.from));
  const longestRun = runs.length ? runs[0].to - runs[0].from : 0;
  const sharedWords = runs.reduce((sum, run) => sum + (run.to - run.from), 0);
  const sharedShare = sharedWords / article.length;
  const order = sources
    .map((text) => followedOrder(articleMd, text))
    .reduce((best, next) => (next.run > best.run ? next : best), { run: 0, share: 0 });

  const reasons: string[] = [];
  if (longestRun >= ORIGINALITY.maxSharedRun) reasons.push(`совпадает фрагмент из ${longestRun} слов подряд`);
  if (sharedShare >= ORIGINALITY.maxSharedShare) reasons.push(`совпадающие фрагменты — ${Math.round(sharedShare * 100)}% текста`);
  if (order.run >= ORIGINALITY.orderRun && order.share >= ORIGINALITY.orderShare) {
    reasons.push(`${order.run} абзацев подряд пересказывают исходник в его порядке`);
  }
  return {
    longestRun,
    sharedShare,
    orderRun: order.run,
    orderShare: order.share,
    fragments: runs.slice(0, 5).map((run) => article.slice(run.from, run.to).map((t) => t.raw).join(" ")),
    blocked: reasons.length > 0,
    reasons,
  };
}
