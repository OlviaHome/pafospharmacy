import { LOCALE_FORMAT_IDS } from "./config";
import type { FinderMessages, Locale } from "./types";

export function message(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => String(values[key] ?? ""));
}

export function formatLocalizedNumber(value: number, locale: Locale): string {
  return new Intl.NumberFormat(LOCALE_FORMAT_IDS[locale]).format(value);
}

export function formatResultCount(
  value: number,
  locale: Locale,
  messages: FinderMessages,
): string {
  const category = new Intl.PluralRules(LOCALE_FORMAT_IDS[locale]).select(value);
  const template =
    category === "one"
      ? messages.resultOne
      : category === "few"
        ? messages.resultFew
        : category === "many"
          ? messages.resultMany
          : messages.resultOther;
  return message(template, { count: formatLocalizedNumber(value, locale) });
}
