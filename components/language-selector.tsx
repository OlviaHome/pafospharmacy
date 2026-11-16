"use client";

import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef } from "react";

import {
  LOCALE_COOKIE_MAX_AGE_SECONDS,
  LOCALE_COOKIE_NAME,
  LOCALE_NAMES,
  localizePath,
} from "@/lib/i18n/config";
import { HospitalFilterSelect } from "@/components/hospital-filter-select";
import type { Locale } from "@/lib/i18n/types";

/**
 * Query string to keep when the site language changes. The blog's article-language choice
 * (?lang=) is dropped, so switching the site language also switches the article.
 */
function searchWithoutArticleLanguage(): string {
  const params = new URLSearchParams(window.location.search);
  params.delete("lang");
  const query = params.toString();
  return query ? `?${query}` : "";
}

export function LanguageSelector({
  locale,
  label,
}: {
  locale: Locale;
  label: string;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const prefetchedUrls = useRef(new Set<string>());

  const prefetchAlternateLocales = useCallback(() => {
    for (const nextLocale of Object.keys(LOCALE_NAMES) as Locale[]) {
      if (nextLocale === locale) continue;
      const href = `${localizePath(pathname, nextLocale)}${searchWithoutArticleLanguage()}`;
      if (prefetchedUrls.current.has(href)) continue;
      prefetchedUrls.current.add(href);
      router.prefetch(href);
    }
  }, [locale, pathname, router]);

  useEffect(() => {
    const requestIdleCallback = window.requestIdleCallback;
    if (typeof requestIdleCallback === "function") {
      const idleCallback = requestIdleCallback(prefetchAlternateLocales, {
        timeout: 1_500,
      });
      return () => window.cancelIdleCallback(idleCallback);
    }

    const timer = window.setTimeout(prefetchAlternateLocales, 0);
    return () => window.clearTimeout(timer);
  }, [prefetchAlternateLocales]);

  function chooseLocale(nextLocale: Locale) {
    const secure = window.location.protocol === "https:" ? "; Secure" : "";
    document.cookie = `${LOCALE_COOKIE_NAME}=${nextLocale}; Max-Age=${LOCALE_COOKIE_MAX_AGE_SECONDS}; Path=/; SameSite=Lax${secure}`;
    router.push(`${localizePath(pathname, nextLocale)}${searchWithoutArticleLanguage()}`);
  }

  return (
    <HospitalFilterSelect
      variant="compact"
      label={label}
      value={locale}
      onPrepare={prefetchAlternateLocales}
      onChange={(next) => chooseLocale(next as Locale)}
      options={(Object.entries(LOCALE_NAMES) as [Locale, string][]).map(
        ([value, name]) => ({ value, label: name, lang: value }),
      )}
    />
  );
}
