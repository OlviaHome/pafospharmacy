import { isLocale, SUPPORTED_LOCALES } from "@/lib/i18n/config";
import type { Locale } from "@/lib/i18n/types";

import type {
  BlogBodySegment,
  BlogImage,
  BlogPost,
  BlogTranslation,
} from "./types";

const IMAGE_MARKER = /^[ \t]*\[\[image:([a-z0-9-]{1,40})\]\][ \t]*$/gm;

/** Splits a Markdown body into text and image segments at [[image:<slot>]] lines. */
export function splitBody(bodyMd: string): BlogBodySegment[] {
  const segments: BlogBodySegment[] = [];
  let cursor = 0;
  for (const match of bodyMd.matchAll(IMAGE_MARKER)) {
    const text = bodyMd.slice(cursor, match.index).trim();
    if (text) segments.push({ type: "markdown", text });
    segments.push({ type: "image", slot: match[1] });
    cursor = match.index + match[0].length;
  }
  const rest = bodyMd.slice(cursor).trim();
  if (rest) segments.push({ type: "markdown", text: rest });
  return segments;
}

/** Locales with a translation, in the site's locale order. */
export function translationLocales(post: BlogPost): Locale[] {
  const present = new Set(post.translations.map((translation) => translation.locale));
  return SUPPORTED_LOCALES.filter((locale) => present.has(locale));
}

const FALLBACK_ORDER: Locale[] = ["en", "ru", "el", "ar"];

export interface ChosenTranslation {
  translation: BlogTranslation;
  /** True when the site locale had no translation and another language is shown. */
  isFallback: boolean;
  /** True when the reader picked another article language with ?lang=. */
  isExplicitChoice: boolean;
}

/**
 * Picks which translation to show. The article opens in the site language;
 * an explicit ?lang= choice shows another language without switching the site.
 */
export function chooseTranslation(
  post: BlogPost,
  siteLocale: Locale,
  requestedLang?: string | null,
): ChosenTranslation | null {
  const byLocale = new Map(post.translations.map((t) => [t.locale, t]));
  if (isLocale(requestedLang) && requestedLang !== siteLocale) {
    const requested = byLocale.get(requestedLang);
    if (requested) return { translation: requested, isFallback: false, isExplicitChoice: true };
  }
  const own = byLocale.get(siteLocale);
  if (own) return { translation: own, isFallback: false, isExplicitChoice: false };
  for (const locale of FALLBACK_ORDER) {
    const fallback = byLocale.get(locale);
    if (fallback) return { translation: fallback, isFallback: true, isExplicitChoice: false };
  }
  return null;
}

export function findImage(post: BlogPost, slot: string): BlogImage | undefined {
  return post.images.find((image) => image.slot === slot);
}

export function imageAlt(image: BlogImage, locale: Locale): string {
  return image.alt[locale] ?? image.alt.en ?? image.alt.ru ?? "";
}

/** Rough reading time at about 200 words per minute, never below one minute. */
export function readingMinutes(translation: BlogTranslation): number {
  const text = [
    translation.bodyMd,
    ...translation.faq.flatMap((item) => [item.question, item.answer]),
  ].join(" ");
  const words = text.replace(/\[\[image:[^\]]+\]\]/g, " ").split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / 200));
}

export function fillTemplate(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (whole, key: string) =>
    key in values ? String(values[key]) : whole,
  );
}
