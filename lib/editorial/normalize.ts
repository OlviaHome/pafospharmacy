import type { Locale } from "@/lib/i18n/types";

import { cleanClaims } from "./facts";
import { INTERNAL_PAGES, type ArticleDraft, type ArticleImagePlan, type TranslationDraft } from "./prompts";

const MARKER = /\[\[image:([a-z0-9-]{1,40})\]\]/g;
const SLOT_PATTERN = /^(cover|inline-\d{1,2})$/;

/** Puts every image marker on its own paragraph line and tidies blank lines. */
function isolateMarkers(body: string): string {
  return body
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]*\[\[image:([a-z0-9-]{1,40})\]\][ \t]*/g, "\n\n[[image:$1]]\n\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function markerSlots(body: string): string[] {
  return [...body.matchAll(MARKER)].map((match) => match[1]);
}

/** Body headings start at h2; the page title is the only h1. */
function demoteH1(body: string): string {
  return body.replace(/^# (?=\S)/gm, "## ");
}

function cleanSources(sources: { title: string; url: string }[]) {
  const seen = new Set<string>();
  return sources
    .map((source) => ({ title: source.title.trim(), url: source.url.trim() }))
    .filter((source) => {
      if (!/^https:\/\/[^\s]+$/.test(source.url) || seen.has(source.url)) return false;
      seen.add(source.url);
      return true;
    })
    .map((source) => ({ ...source, title: source.title || new URL(source.url).hostname }))
    .slice(0, 12);
}

function cleanFaq(faq: { question: string; answer: string }[]) {
  return faq
    .map((item) => ({ question: item.question.trim(), answer: item.answer.trim() }))
    .filter((item) => item.question && item.answer)
    .slice(0, 8);
}

export interface NormalizedArticle extends ArticleDraft {
  /** Problems the editor should see in the draft card. */
  warnings: string[];
}

/**
 * Makes a model draft safe and consistent: one cover, every inline marker backed by an image plan,
 * no orphan plans, https-only deduplicated sources, Markdown without h1.
 */
export function normalizeArticle(draft: ArticleDraft): NormalizedArticle {
  const warnings: string[] = [];
  let body = demoteH1(isolateMarkers(draft.body_md));
  // The cover never appears in the body.
  body = body.replace(/^\[\[image:cover\]\]$/gm, "").replace(/\n{3,}/g, "\n\n").trim();

  const plans = new Map<string, ArticleImagePlan>();
  for (const plan of draft.images) {
    const slot = plan.slot.trim().toLowerCase();
    if (!SLOT_PATTERN.test(slot) || plans.has(slot)) continue;
    plans.set(slot, {
      ...plan,
      slot,
      search_query: plan.kind === "stock" ? plan.search_query.trim() : "",
      alt: plan.alt.trim(),
      note: plan.note.trim(),
    });
  }

  // A slot can appear only once; later repeats are dropped.
  const seen = new Set<string>();
  body = body
    .split("\n")
    .filter((line) => {
      const match = /^\[\[image:([a-z0-9-]{1,40})\]\]$/.exec(line);
      if (!match) return true;
      if (seen.has(match[1])) return false;
      seen.add(match[1]);
      return true;
    })
    .join("\n");
  for (const slot of seen) {
    if (!plans.has(slot)) {
      plans.set(slot, { slot, kind: "screenshot", search_query: "", alt: "", note: "картинка по смыслу этого места" });
      warnings.push(`Для ${slot} не было описания картинки — оставлено место для своей.`);
    }
  }
  for (const slot of [...plans.keys()]) {
    if (slot !== "cover" && !seen.has(slot)) plans.delete(slot);
  }
  if (!plans.has("cover")) {
    plans.set("cover", { slot: "cover", kind: "stock", search_query: "cyprus healthcare", alt: draft.title, note: "" });
  }

  const sources = cleanSources(draft.sources);
  if (sources.length === 0) warnings.push("Нет ни одного источника — проверьте факты особенно внимательно.");

  const links = checkInternalLinks(body);
  body = links.body;
  warnings.push(...links.removed.map((url) => `Ссылка на несуществующую страницу сайта убрана: ${url}`));

  return {
    slug: draft.slug,
    title: draft.title.trim(),
    description: draft.description.trim(),
    body_md: body.replace(/\n{3,}/g, "\n\n").trim(),
    faq: cleanFaq(draft.faq),
    sources,
    images: [...plans.values()],
    claims: cleanClaims(draft.claims),
    editor_notes: draft.editor_notes.trim(),
    warnings,
  };
}

const LOCALE_PATH = "(?:ru|en|el|ar)";
const ALLOWED_INTERNAL = new RegExp(
  `^/${LOCALE_PATH}(?:/(?:${INTERNAL_PAGES.map((page) => page.path.split("/")[2]).filter(Boolean).join("|")}|blog))?/?$`,
);

/** HealthGuide.cy links must point to existing pages; others become plain text. */
export function checkInternalLinks(body: string): { body: string; removed: string[] } {
  const removed: string[] = [];
  const next = body.replace(/\[([^\]]+)\]\(((?:https?:\/\/(?:www\.)?healthguide\.cy)?(\/[^)\s]*))\)/g, (whole, text: string, url: string, path: string) => {
    if (ALLOWED_INTERNAL.test(path.split(/[?#]/)[0])) return whole;
    removed.push(url);
    return text;
  });
  return { body: next, removed };
}

/** Points HealthGuide.cy links of a translation to the same page in its own language. */
export function localizeInternalLinks(body: string, locale: Locale): string {
  return body.replace(
    /\]\(((?:https?:\/\/(?:www\.)?healthguide\.cy)?)\/(?:ru|en|el|ar)(?=[/)?#])/g,
    (_whole, origin: string) => `](${origin}/${locale}`,
  );
}

/** Keeps a translation's image markers identical to the source article's. */
export function normalizeTranslation(draft: TranslationDraft, sourceBody: string, locale?: Locale): TranslationDraft {
  const expected = markerSlots(sourceBody);
  let body = demoteH1(isolateMarkers(draft.body_md));
  const present = new Set<string>();
  body = body.replace(/^\[\[image:([a-z0-9-]{1,40})\]\]$/gm, (line, slot: string) => {
    if (!expected.includes(slot) || present.has(slot)) return "";
    present.add(slot);
    return line;
  });
  const missing = expected.filter((slot) => !present.has(slot));
  if (missing.length > 0) body = `${body}\n\n${missing.map((slot) => `[[image:${slot}]]`).join("\n\n")}`;
  return {
    title: draft.title.trim(),
    description: draft.description.trim(),
    body_md: (locale ? localizeInternalLinks(body, locale) : body).replace(/\n{3,}/g, "\n\n").trim(),
    faq: cleanFaq(draft.faq),
    sources: cleanSources(draft.sources),
    image_alts: draft.image_alts,
  };
}

export function wordCount(markdown: string): number {
  return markdown.replace(MARKER, " ").split(/\s+/).filter(Boolean).length;
}
