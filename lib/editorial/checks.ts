import { SEO_TITLE_MAX, seoTitle } from "@/lib/blog/content";
import type { BlogFaqItem, BlogSource } from "@/lib/blog/types";
import type { Locale } from "@/lib/i18n/types";

import { markerSlots, wordCount } from "./normalize";
import { sourceKind } from "./prompts";

export interface SourceCheck {
  url: string;
  state: "ok" | "broken" | "unverified";
  status: number | null;
  checkedAt: string;
}

export interface CheckableTranslation {
  locale: Locale;
  title: string;
  description: string;
  bodyMd: string;
  faq: BlogFaqItem[];
  sources: BlogSource[];
}

export interface CheckResult {
  id: string;
  ok: boolean;
  /** Short Russian line for the editor's card. */
  label: string;
}

export const MIN_RUSSIAN_WORDS = 700;
export const DESCRIPTION_RANGE = [120, 160] as const;
export const MIN_FAQ = 4;
export const MIN_SCRIPT_SHARE = 0.6;
export const MIN_LENGTH_RATIO = 0.6;

const SCRIPT: Record<Locale, RegExp> = {
  ru: /\p{Script=Cyrillic}/u,
  en: /\p{Script=Latin}/u,
  el: /\p{Script=Greek}/u,
  ar: /\p{Script=Arabic}/u,
};

const SHORT: Record<Locale, string> = { ru: "RU", en: "EN", el: "EL", ar: "AR" };

/** Letters of the readable text, without URLs, image markers and Markdown syntax. */
export function textLetters(markdown: string): string[] {
  const text = markdown
    .replace(/\[\[image:[^\]]+\]\]/g, " ")
    .replace(/\]\([^)]*\)/g, "]")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/`[^`]*`/g, " ");
  return [...text].filter((char) => /\p{L}/u.test(char));
}

/** Share of letters written in the language's own alphabet (0–1). */
export function scriptShare(markdown: string, locale: Locale): number {
  const letters = textLetters(markdown);
  if (letters.length === 0) return 0;
  return letters.filter((char) => SCRIPT[locale].test(char)).length / letters.length;
}

function sameMarkers(a: string, b: string): boolean {
  return markerSlots(a).join(",") === markerSlots(b).join(",");
}

/**
 * Automatic checks before publishing the given languages. Failing checks do not block
 * publication on their own: the editor sees them and must confirm.
 */
export function prePublishChecks(
  translations: CheckableTranslation[],
  locales: Locale[],
  sourceChecks: SourceCheck[],
  siteTitles: Record<Locale, string>,
): CheckResult[] {
  const results: CheckResult[] = [];
  const russian = translations.find((t) => t.locale === "ru");
  const selected = locales.flatMap((locale) => translations.filter((t) => t.locale === locale));

  for (const locale of locales) {
    if (!selected.some((t) => t.locale === locale)) {
      results.push({ id: `missing-${locale}`, ok: false, label: `Нет текста ${SHORT[locale]}` });
    }
  }

  if (russian && locales.includes("ru")) {
    const words = wordCount(russian.bodyMd);
    results.push({
      id: "ru-words",
      ok: words >= MIN_RUSSIAN_WORDS,
      label: `Объём RU: ${words} слов (нужно от ${MIN_RUSSIAN_WORDS})`,
    });
  }

  for (const t of selected) {
    const tag = SHORT[t.locale];
    const title = seoTitle(t.title.trim(), siteTitles[t.locale]);
    results.push({
      id: `title-${t.locale}`,
      ok: t.title.trim().length > 0 && title.length <= SEO_TITLE_MAX,
      label: `Заголовок ${tag} в поиске: ${title.length} симв. (до ${SEO_TITLE_MAX})`,
    });
    const description = t.description.trim().length;
    results.push({
      id: `description-${t.locale}`,
      ok: description >= DESCRIPTION_RANGE[0] && description <= DESCRIPTION_RANGE[1],
      label: `Описание ${tag}: ${description} симв. (${DESCRIPTION_RANGE[0]}–${DESCRIPTION_RANGE[1]})`,
    });
    results.push({
      id: `faq-${t.locale}`,
      ok: t.faq.length >= MIN_FAQ,
      label: `FAQ ${tag}: ${t.faq.length} (нужно от ${MIN_FAQ})`,
    });

    if (t.locale !== "ru" && russian) {
      const share = scriptShare(t.bodyMd, t.locale);
      results.push({
        id: `script-${t.locale}`,
        ok: share >= MIN_SCRIPT_SHARE,
        label: `Перевод ${tag} на своём алфавите: ${Math.round(share * 100)}%`,
      });
      const ratio = textLetters(t.bodyMd).length / Math.max(1, textLetters(russian.bodyMd).length);
      results.push({
        id: `length-${t.locale}`,
        ok: ratio >= MIN_LENGTH_RATIO,
        label: `Длина перевода ${tag}: ${Math.round(ratio * 100)}% от RU (нужно от ${Math.round(MIN_LENGTH_RATIO * 100)}%)`,
      });
      results.push({
        id: `markers-${t.locale}`,
        ok: sameMarkers(t.bodyMd, russian.bodyMd),
        label: `Картинки в ${tag} на тех же местах, что в RU`,
      });
    }
  }

  const urls = [...new Set(selected.flatMap((t) => t.sources.map((source) => source.url)))];
  const official = urls.filter((url) => sourceKind(url) === "official").length;
  results.push({
    id: "official-source",
    ok: official > 0,
    label: official > 0 ? `Официальных источников: ${official}` : "Нет ни одного официального источника",
  });

  const byUrl = new Map(sourceChecks.map((check) => [check.url, check]));
  const broken = urls.filter((url) => byUrl.get(url)?.state === "broken");
  const unverified = urls.filter((url) => byUrl.get(url)?.state === "unverified");
  const unchecked = urls.filter((url) => !byUrl.has(url));
  const host = (url: string) => {
    try {
      return new URL(url).hostname;
    } catch {
      return url;
    }
  };
  const problems = [
    ...broken.map((url) => `не открывается: ${host(url)}`),
    ...unverified.map((url) => `сайт не дал проверить: ${host(url)}`),
    ...unchecked.map((url) => `не проверена: ${host(url)}`),
  ];
  results.push({
    id: "links",
    ok: urls.length > 0 && problems.length === 0,
    label:
      urls.length === 0
        ? "Нет источников"
        : problems.length === 0
          ? `Все ссылки на источники открываются (${urls.length})`
          : `Ссылки: ${problems.join("; ")}`,
  });

  return results;
}

export function failedChecks(results: CheckResult[]): CheckResult[] {
  return results.filter((result) => !result.ok);
}

export function formatChecks(results: CheckResult[]): string {
  return results.map((result) => `${result.ok ? "✅" : "⚠️"} ${result.label}`).join("\n");
}
