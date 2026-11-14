import { SEO_TITLE_MAX } from "@/lib/blog/content";
import type { BlogFaqItem, BlogSource } from "@/lib/blog/types";
import type { Locale } from "@/lib/i18n/types";

import { factItems, type FactEntry, type FactItem } from "./facts";
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
  /** "draft" marks a translation that no longer matches the Russian text. */
  status?: "draft" | "review" | "published";
}

export interface CheckResult {
  id: string;
  ok: boolean;
  /** Short Russian line for the editor's card. */
  label: string;
  /** A failing blocking check stops publication; other failures need the editor's confirmation. */
  blocking?: boolean;
}

/** Below this the text is probably cut off; there is no upper limit and no target length. */
export const MIN_RUSSIAN_WORDS = 250;
export const DESCRIPTION_RANGE = [120, 160] as const;
export const MAX_FAQ = 6;
export const MIN_SCRIPT_SHARE = 0.6;

/** Claims the site or official data update "in real time" or are "always current". */
const REALTIME_CLAIM = /в реальном времени|в режиме реального времени|real[- ]time|всегда актуальн|always up[- ]to[- ]date|σε πραγματικό χρόνο|في الوقت الفعلي/i;

function sectionCount(markdown: string): number {
  return (markdown.match(/^## /gm) ?? []).length;
}

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
 * Automatic checks before publishing the given languages. Failing blocking checks (unconfirmed
 * critical facts) stop publication; other failures need the editor's explicit confirmation.
 */
export function prePublishChecks(
  translations: CheckableTranslation[],
  locales: Locale[],
  sourceChecks: SourceCheck[],
  factEntries: FactEntry[] = [],
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
      label:
        words >= MIN_RUSSIAN_WORDS
          ? `Объём RU: ${words} слов`
          : `Объём RU: ${words} слов — похоже, текст обрезан`,
    });
  }

  for (const t of selected) {
    const tag = SHORT[t.locale];
    const title = t.title.trim();
    results.push({
      id: `title-${t.locale}`,
      ok: title.length > 0 && title.length <= SEO_TITLE_MAX,
      label: `Заголовок ${tag}: ${title.length} симв. (до ${SEO_TITLE_MAX})`,
    });
    if (t.status === "draft") {
      results.push({
        id: `outdated-${t.locale}`,
        ok: false,
        label: `${tag} устарел после правок RU — обновите перевод`,
      });
    }
    const description = t.description.trim().length;
    results.push({
      id: `description-${t.locale}`,
      ok: description >= DESCRIPTION_RANGE[0] && description <= DESCRIPTION_RANGE[1],
      label: `Описание ${tag}: ${description} симв. (${DESCRIPTION_RANGE[0]}–${DESCRIPTION_RANGE[1]})`,
    });
    results.push({
      id: `faq-${t.locale}`,
      ok: t.faq.length <= MAX_FAQ,
      label:
        t.faq.length <= MAX_FAQ
          ? `FAQ ${tag}: ${t.faq.length}`
          : `FAQ ${tag}: ${t.faq.length} — больше ${MAX_FAQ}, проверьте, нет ли заполнителей`,
    });
    if (REALTIME_CLAIM.test(`${t.title}\n${t.description}\n${t.bodyMd}\n${t.faq.map((f) => f.answer).join("\n")}`)) {
      results.push({
        id: `realtime-${t.locale}`,
        ok: false,
        label: `${tag}: в тексте обещание данных «в реальном времени» — уберите`,
      });
    }

    if (t.locale !== "ru" && russian) {
      const share = scriptShare(t.bodyMd, t.locale);
      results.push({
        id: `script-${t.locale}`,
        ok: share >= MIN_SCRIPT_SHARE,
        label: `Перевод ${tag} на своём алфавите: ${Math.round(share * 100)}%`,
      });
      // Completeness by structure, not by length: same sections and FAQ items as the Russian text.
      const complete =
        sectionCount(t.bodyMd) === sectionCount(russian.bodyMd) && t.faq.length === russian.faq.length;
      results.push({
        id: `structure-${t.locale}`,
        ok: complete,
        label: complete
          ? `Перевод ${tag} полный: те же разделы и вопросы FAQ`
          : `Перевод ${tag}: разделов ${sectionCount(t.bodyMd)} из ${sectionCount(russian.bodyMd)}, FAQ ${t.faq.length} из ${russian.faq.length}`,
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
          ? `Ссылки на источники открываются (${urls.length}) — это ещё не проверка фактов`
          : `Ссылки: ${problems.join("; ")}`,
  });

  if (russian && locales.includes("ru")) results.push(...factResults(factItems(factEntries, russian.bodyMd)));

  return results;
}

/** Fact items as checks: unconfirmed critical facts block publication. */
export function factResults(items: FactItem[]): CheckResult[] {
  const blocking = items.filter((item) => item.blocking);
  const found = items.filter((item) => item.status === "quote_found").length;
  const manual = items.filter((item) => item.status === "manual").length;
  const weak = items.filter((item) => !item.blocking && item.importance === "normal" && item.status !== "quote_found" && item.status !== "manual");
  const results: CheckResult[] = [
    {
      id: "facts-critical",
      ok: blocking.length === 0,
      blocking: true,
      label:
        blocking.length === 0
          ? `Факты: цитата найдена ${found}, проверено вручную ${manual} (цитата ≠ доказательство, читайте)`
          : `Факты: ${blocking.length} важных не подтверждены — публикация заблокирована (кнопка «🔎 Факты»)`,
    },
  ];
  if (weak.length > 0) {
    results.push({ id: "facts-normal", ok: false, label: `Факты: ${weak.length} второстепенных без найденной цитаты` });
  }
  return results;
}

export function blockingFailures(results: CheckResult[]): CheckResult[] {
  return results.filter((result) => !result.ok && result.blocking);
}

export function failedChecks(results: CheckResult[]): CheckResult[] {
  return results.filter((result) => !result.ok);
}

export function formatChecks(results: CheckResult[]): string {
  return results.map((result) => `${result.ok ? "✅" : result.blocking ? "🔴" : "⚠️"} ${result.label}`).join("\n");
}
