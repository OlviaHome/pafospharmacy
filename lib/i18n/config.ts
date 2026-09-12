import type { Locale } from "./types";

export const SUPPORTED_LOCALES = ["en", "el", "ru", "ar"] as const;
export const DEFAULT_LOCALE: Locale = "en";
export const LOCALE_COOKIE_NAME = "paphos_locale";
export const LOCALE_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

export const LOCALE_NAMES: Record<Locale, string> = {
  en: "English",
  el: "Ελληνικά",
  ru: "Русский",
  ar: "العربية",
};

export const LOCALE_FORMAT_IDS: Record<Locale, string> = {
  en: "en-GB",
  el: "el-CY",
  ru: "ru-RU",
  ar: "ar",
};

export function isLocale(value: string | undefined | null): value is Locale {
  return SUPPORTED_LOCALES.includes(value as Locale);
}

export function localeDirection(locale: Locale): "ltr" | "rtl" {
  return locale === "ar" ? "rtl" : "ltr";
}

export function localizePath(pathname: string, locale: Locale): string {
  const segments = pathname.split("/");
  if (isLocale(segments[1])) segments[1] = locale;
  else segments.splice(1, 0, locale);
  const localized = segments.join("/");
  return localized === `/${locale}/` ? `/${locale}` : localized;
}

export function localePath(locale: Locale, pathname = ""): string {
  const suffix = pathname === "/" ? "" : pathname;
  return `/${locale}${suffix}`;
}

export function preferredLocale(
  cookieValue: string | undefined,
  acceptLanguage: string | null,
): Locale {
  if (isLocale(cookieValue)) return cookieValue;
  if (!acceptLanguage) return DEFAULT_LOCALE;

  const preferences = acceptLanguage
    .split(",")
    .map((item, index) => {
      const [tag, ...parameters] = item.trim().split(";");
      const qualityParameter = parameters.find((value) => value.trim().startsWith("q="));
      const quality = qualityParameter
        ? Number.parseFloat(qualityParameter.trim().slice(2))
        : 1;
      return { tag: tag.toLocaleLowerCase("en"), quality, index };
    })
    .filter((item) => item.tag && Number.isFinite(item.quality) && item.quality > 0)
    .sort((left, right) => right.quality - left.quality || left.index - right.index);

  for (const preference of preferences) {
    const base = preference.tag.split("-", 1)[0];
    if (isLocale(base)) return base;
  }
  return DEFAULT_LOCALE;
}
