import { LOCALE_FORMAT_IDS } from "@/lib/i18n/config";
import type { Locale } from "@/lib/i18n/types";

export function formatBlogDate(iso: string, locale: Locale): string {
  return new Intl.DateTimeFormat(LOCALE_FORMAT_IDS[locale], {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Asia/Nicosia",
  }).format(new Date(iso));
}

/** Same calendar day in Cyprus, so "updated" is shown only for later edits. */
export function isSameCyprusDay(a: string, b: string): boolean {
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Nicosia" });
  return day.format(new Date(a)) === day.format(new Date(b));
}
