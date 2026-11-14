import type { Locale } from "@/lib/i18n/types";

/**
 * Official sources: Cyprus government and public health bodies, the EU and the WHO.
 * Subdomains count too (moh.gov.cy matches gov.cy).
 */
export const OFFICIAL_SOURCE_DOMAINS = [
  "gov.cy",
  "gesy.org.cy",
  "hio.org.cy",
  "shso.org.cy",
  "europa.eu",
  "who.int",
];

/**
 * Reliable but not governmental: not flagged as unofficial, but they do not count as the
 * official source every article needs. CyLaw publishes Cyprus legislation but is not run
 * by the state.
 */
export const TRUSTED_SOURCE_DOMAINS = ["cylaw.org"];

export type SourceKind = "official" | "trusted" | "other";

function matchesDomain(url: string, domains: string[]): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return domains.some((domain) => host === domain || host.endsWith(`.${domain}`));
  } catch {
    return false;
  }
}

export function sourceKind(url: string): SourceKind {
  if (matchesDomain(url, OFFICIAL_SOURCE_DOMAINS)) return "official";
  if (matchesDomain(url, TRUSTED_SOURCE_DOMAINS)) return "trusted";
  return "other";
}

export function isOfficialUrl(url: string): boolean {
  return sourceKind(url) === "official";
}

const faqSchema = {
  type: "array",
  items: {
    type: "object",
    additionalProperties: false,
    properties: { question: { type: "string" }, answer: { type: "string" } },
    required: ["question", "answer"],
  },
};

const sourcesSchema = {
  type: "array",
  items: {
    type: "object",
    additionalProperties: false,
    properties: { title: { type: "string" }, url: { type: "string" } },
    required: ["title", "url"],
  },
};

export interface ArticleImagePlan {
  slot: string;
  kind: "stock" | "screenshot";
  search_query: string;
  alt: string;
  note: string;
}

export interface ArticleDraft {
  slug: string;
  title: string;
  description: string;
  body_md: string;
  faq: { question: string; answer: string }[];
  sources: { title: string; url: string }[];
  images: ArticleImagePlan[];
  /** Key statements with a verbatim quote from their source; missing in older drafts. */
  claims?: { claim: string; importance: "critical" | "normal"; source_url: string; quote: string }[];
  editor_notes: string;
}

export const ARTICLE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    slug: { type: "string", description: "Short English kebab-case URL slug, max 60 chars." },
    title: { type: "string", description: "At most 55 characters." },
    description: { type: "string", description: "Meta description, 130–155 characters." },
    body_md: { type: "string" },
    faq: faqSchema,
    sources: sourcesSchema,
    images: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          slot: { type: "string", description: "'cover' or 'inline-1', 'inline-2', …" },
          kind: { type: "string", enum: ["stock", "screenshot"] },
          search_query: { type: "string", description: "English stock photo query (2–4 words); empty for screenshots." },
          alt: { type: "string", description: "Alt text in the article language." },
          note: { type: "string", description: "For screenshots: exactly what the editor should capture, in Russian." },
        },
        required: ["slot", "kind", "search_query", "alt", "note"],
      },
    },
    claims: {
      type: "array",
      description: "Every key factual statement of body_md and FAQ, each with a verbatim quote from its source.",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          claim: { type: "string", description: "The statement as written in the article (Russian)." },
          importance: { type: "string", enum: ["critical", "normal"] },
          source_url: { type: "string", description: "The exact https URL of the page or PDF that contains the quote." },
          quote: {
            type: "string",
            description: "20–300 characters copied character for character from that source, in its own language.",
          },
        },
        required: ["claim", "importance", "source_url", "quote"],
      },
    },
    editor_notes: {
      type: "string",
      description: "In Russian, for the human editor only: facts you could not fully verify, conflicting sources, things to double-check.",
    },
  },
  required: ["slug", "title", "description", "body_md", "faq", "sources", "images", "claims", "editor_notes"],
};

/** HealthGuide.cy pages an article may link to (Russian paths; translations get their own locale). */
export const INTERNAL_PAGES: { path: string; label: string }[] = [
  { path: "/ru", label: "поиск открытых и дежурных аптек по всему Кипру" },
  { path: "/ru/paphos", label: "дежурные аптеки Пафоса" },
  { path: "/ru/limassol", label: "дежурные аптеки Лимассола" },
  { path: "/ru/larnaca", label: "дежурные аптеки Ларнаки" },
  { path: "/ru/nicosia", label: "дежурные аптеки Никосии" },
  { path: "/ru/famagusta", label: "дежурные аптеки Фамагусты" },
];

export interface TranslationDraft {
  title: string;
  description: string;
  body_md: string;
  faq: { question: string; answer: string }[];
  sources: { title: string; url: string }[];
  image_alts: { slot: string; alt: string }[];
}

export const TRANSLATION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    title: { type: "string" },
    description: { type: "string" },
    body_md: { type: "string" },
    faq: faqSchema,
    sources: sourcesSchema,
    image_alts: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: { slot: { type: "string" }, alt: { type: "string" } },
        required: ["slot", "alt"],
      },
    },
  },
  required: ["title", "description", "body_md", "faq", "sources", "image_alts"],
};

const LANGUAGE_NAMES: Record<Locale, string> = {
  en: "English",
  ru: "Russian",
  el: "Greek",
  ar: "Modern Standard Arabic",
};

function monthYear(now: Date): string {
  return new Intl.DateTimeFormat("ru-RU", { month: "long", year: "numeric", timeZone: "Asia/Nicosia" }).format(now);
}

const INTERNAL_PAGES_LIST = INTERNAL_PAGES.map((page) => `${page.path} (${page.label})`).join(", ");

const SHARED_RULES = `
Site: HealthGuide Cyprus (healthguide.cy), an independent guide to healthcare in Cyprus: pharmacies, GeSY (ГеСИ), doctors and hospitals.
It is not affiliated with the government or the Health Insurance Organisation (HIO).

Accuracy rules (most important):
- Use the web_search tool and rely on what the sources actually say. Prefer official sources: gesy.org.cy, hio.org.cy, moh.gov.cy, gov.cy, cyprus.gov.cy, pio.gov.cy, europa.eu.
- Every concrete fact — eligibility, fees, co-payments, deadlines, phone numbers, addresses, opening hours, URLs, step names on a portal — must come from a source you opened. Never invent or estimate numbers. If sources disagree or you are unsure, say so neutrally in the text ("уточните на портале") and explain it in editor_notes.
- Only list sources you actually used. Use full https URLs. Put the official portal first.
- Do not give personal medical advice. Point readers to a doctor, a pharmacist or 112 in emergencies where relevant.
- List every key factual statement in "claims", with the exact source URL and a quote of 20–300 characters copied character for character from that page or PDF (in the source's language, never translated or paraphrased). importance "critical" = medical, legal or administrative facts: eligibility, fees, co-payments, deadlines, required documents, phone numbers, addresses, opening hours, doses, procedures and portal steps; everything else "normal". Every figure in body_md (amounts, percentages, dates, numbers) must appear in at least one claim. If you cannot quote a source for a fact, leave the fact out or mark it "уточните на портале".
- Never state or imply that data on HealthGuide.cy or on official sites is updated in real time or is always current. Use "по состоянию на <месяц год>" and send readers to the official source for the latest information.
- Never invent quotes, testimonials, first-person stories ("я", "мы проверили") or case studies with names or numbers. An example is allowed only when it is generic and clearly labelled as one, starting with "Пример:" (in translations: the same word in that language), and it must not present invented figures as facts.

Format rules for body_md:
- body_md starts with a "## Коротко" section (in translations: the same heading in that language) of 1–3 substantive bullet points that answer the main question on their own. No filler bullets.
- Give practical value: concrete actions for the reader (what to do, where, what to bring, whom to call) as numbered steps or a short checklist.
- Link to a HealthGuide.cy page only where it really helps the reader, naturally in the text, and only to these paths: ${INTERNAL_PAGES_LIST}. Never invent other HealthGuide.cy URLs.
- Where natural, write ## headings as the questions readers ask (e.g. "## Кто может пользоваться ГеСИ?"), and answer each in the first 1–2 sentences under it.
- Markdown only: ## and ### headings, paragraphs, lists, numbered steps, short tables, **bold**, links. No HTML, no H1, no images in Markdown syntax.
- Do NOT include the title, the FAQ, the sources list or a disclaimer in body_md; the site renders those separately.
- Place images with a line that contains only [[image:inline-1]], [[image:inline-2]], … between paragraphs. Never put the cover in the body.
- Link to official pages inline where it helps (e.g. the GeSY portal).

Images (field images):
- Always one "cover" (kind "stock"). Inline images only where they genuinely help (e.g. a portal screen or a form); none is fine.
- Use kind "screenshot" when the image must show a real portal or document screen (registration steps, a form, a menu). The editor will supply it; write in note exactly what to capture, in Russian. search_query is "" for screenshots.
- For stock images give a concrete English search_query (2–4 words, e.g. "doctor consultation clinic"). Avoid recognisable people as the subject of medical conditions, and avoid flags, logos and text in images.
- Every inline slot in images must appear exactly once in body_md, and every [[image:…]] in body_md must be in images.
`;

export function writeInstructions(now: Date): string {
  return `You are the editor of a Russian-language health information blog.
${SHARED_RULES}
Write in Russian, in a friendly, clear and practical tone (address the reader as "вы"). The audience is everyone: long-term residents, people who recently moved to Cyprus, and visitors.
Length: as long as the topic needs and no longer. A simple practical question: about 500–700 words. A complex topic may be longer only when every section adds needed information. Never pad, repeat or add generic paragraphs. After the "Коротко" section, logical ## sections. Mention once, near the start, that the information is current as of ${monthYear(now)}.
FAQ: usually 2–4 real follow-up questions that the body does not already answer, with short complete answers. If there are none, return an empty FAQ.
title: natural Russian headline, at most 55 characters, contains the main search phrase. description: 130–155 characters.
slug: short English kebab-case (e.g. "gesy-registration-cyprus"), max 60 characters.`;
}

export function editInstructions(now: Date): string {
  return `You are the editor of a Russian-language health information blog, revising an existing draft.
${SHARED_RULES}
Apply the editor's instruction to the article and return the complete updated article in Russian. Change only what the instruction asks for (plus what it directly requires); keep everything else as it is, including image slots, unless the instruction says otherwise. Search the web only if the instruction needs new facts. Return claims for the edited article: keep an unchanged fact's claim, quote and source exactly as they were; change or add claims only for facts you changed or added. The information is current as of ${monthYear(now)}. Keep the same slug.`;
}

export function translateInstructions(target: Locale): string {
  const targetName = LANGUAGE_NAMES[target];
  return `You translate health information articles for HealthGuide Cyprus into ${targetName}.
- Translate naturally and idiomatically for readers in Cyprus; do not add or remove facts.
- Keep Markdown structure, links and URLs exactly (links to HealthGuide.cy pages are adjusted to the language automatically). Keep every [[image:…]] line exactly as it is, on its own line.
- Official names (GeSY / ΓεΣΥ, Health Insurance Organisation / ΟΑΥ, portal menu items) use the form the official ${targetName === "Greek" ? "Greek" : "English or Greek"} sources use.
- Write the title and description for search in ${targetName}: title at most 55 characters, description 130–155 characters.
- Source titles: translate descriptive titles, keep official page names; never change source URLs.
- image_alts: one entry per image slot given in the input, translated.`;
}
