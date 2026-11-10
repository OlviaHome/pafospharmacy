import type { Locale } from "@/lib/i18n/types";

/** Domains treated as official. Others are allowed but flagged to the editor. */
export const OFFICIAL_SOURCE_DOMAINS = [
  "gov.cy",
  "gesy.org.cy",
  "hio.org.cy",
  "moh.gov.cy",
  "cyprus.gov.cy",
  "pio.gov.cy",
  "mof.gov.cy",
  "cylaw.org",
  "europa.eu",
  "who.int",
  "shsorg.org.cy",
  "okypy.org.cy",
];

export function isOfficialUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return OFFICIAL_SOURCE_DOMAINS.some((domain) => host === domain || host.endsWith(`.${domain}`));
  } catch {
    return false;
  }
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
  editor_notes: string;
}

export const ARTICLE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    slug: { type: "string", description: "Short English kebab-case URL slug, max 60 chars." },
    title: { type: "string" },
    description: { type: "string", description: "Meta description, 140–160 characters." },
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
    editor_notes: {
      type: "string",
      description: "In Russian, for the human editor only: facts you could not fully verify, conflicting sources, things to double-check.",
    },
  },
  required: ["slug", "title", "description", "body_md", "faq", "sources", "images", "editor_notes"],
};

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

const SHARED_RULES = `
Site: HealthGuide Cyprus (healthguide.cy), an independent guide to healthcare in Cyprus: pharmacies, GeSY (ГеСИ), doctors and hospitals.
It is not affiliated with the government or the Health Insurance Organisation (HIO).

Accuracy rules (most important):
- Use the web_search tool and rely on what the sources actually say. Prefer official sources: gesy.org.cy, hio.org.cy, moh.gov.cy, gov.cy, cyprus.gov.cy, pio.gov.cy, europa.eu.
- Every concrete fact — eligibility, fees, co-payments, deadlines, phone numbers, addresses, opening hours, URLs, step names on a portal — must come from a source you opened. Never invent or estimate numbers. If sources disagree or you are unsure, say so neutrally in the text ("уточните на портале") and explain it in editor_notes.
- Only list sources you actually used. Use full https URLs. Put the official portal first.
- Do not give personal medical advice. Point readers to a doctor, a pharmacist or 112 in emergencies where relevant.

Format rules for body_md:
- Markdown only: ## and ### headings, paragraphs, lists, numbered steps, short tables, **bold**, links. No HTML, no H1, no images in Markdown syntax.
- Do NOT include the title, the FAQ, the sources list or a disclaimer in body_md; the site renders those separately.
- Place images with a line that contains only [[image:inline-1]], [[image:inline-2]], … between paragraphs. Never put the cover in the body.
- Link to official pages inline where it helps (e.g. the GeSY portal).

Images (field images):
- Always one "cover" (kind "stock") plus at least one inline image; add more only where they help, roughly one per 400–500 words.
- Use kind "screenshot" when the image must show a real portal or document screen (registration steps, a form, a menu). The editor will supply it; write in note exactly what to capture, in Russian. search_query is "" for screenshots.
- For stock images give a concrete English search_query (2–4 words, e.g. "doctor consultation clinic"). Avoid recognisable people as the subject of medical conditions, and avoid flags, logos and text in images.
- Every inline slot in images must appear exactly once in body_md, and every [[image:…]] in body_md must be in images.
`;

export function writeInstructions(now: Date): string {
  return `You are the editor of a Russian-language health information blog.
${SHARED_RULES}
Write in Russian, in a friendly, clear and practical tone (address the reader as "вы"). The audience is everyone: long-term residents, people who recently moved to Cyprus, and visitors.
Length: body_md 1000–1500 words. Start with 2–3 sentences that directly answer the main question. Then logical ## sections with practical steps. Mention once, near the start, that the information is current as of ${monthYear(now)}.
FAQ: 4–6 questions people actually search for, with short complete answers that do not just repeat the body.
title: natural Russian headline, max ~70 characters, contains the main search phrase. description: 140–160 characters.
slug: short English kebab-case (e.g. "gesy-registration-cyprus"), max 60 characters.`;
}

export function editInstructions(now: Date): string {
  return `You are the editor of a Russian-language health information blog, revising an existing draft.
${SHARED_RULES}
Apply the editor's instruction to the article and return the complete updated article in Russian. Change only what the instruction asks for (plus what it directly requires); keep everything else as it is, including image slots, unless the instruction says otherwise. Search the web only if the instruction needs new facts. The information is current as of ${monthYear(now)}. Keep the same slug.`;
}

export function translateInstructions(target: Locale): string {
  const targetName = LANGUAGE_NAMES[target];
  return `You translate health information articles for HealthGuide Cyprus into ${targetName}.
- Translate naturally and idiomatically for readers in Cyprus; do not add or remove facts.
- Keep Markdown structure, links and URLs exactly. Keep every [[image:…]] line exactly as it is, on its own line.
- Official names (GeSY / ΓεΣΥ, Health Insurance Organisation / ΟΑΥ, portal menu items) use the form the official ${targetName === "Greek" ? "Greek" : "English or Greek"} sources use.
- Write the title and description for search in ${targetName}: title max ~70 characters, description 140–160 characters.
- Source titles: translate descriptive titles, keep official page names; never change source URLs.
- image_alts: one entry per image slot given in the input, translated.`;
}
