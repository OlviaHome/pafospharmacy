"use client";

import { usePathname, useRouter } from "next/navigation";

import {
  LOCALE_COOKIE_MAX_AGE_SECONDS,
  LOCALE_COOKIE_NAME,
  LOCALE_NAMES,
  localizePath,
} from "@/lib/i18n/config";
import type { Locale } from "@/lib/i18n/types";

export function LanguageSelector({
  locale,
  label,
}: {
  locale: Locale;
  label: string;
}) {
  const pathname = usePathname();
  const router = useRouter();

  function chooseLocale(nextLocale: Locale) {
    const secure = window.location.protocol === "https:" ? "; Secure" : "";
    document.cookie = `${LOCALE_COOKIE_NAME}=${nextLocale}; Max-Age=${LOCALE_COOKIE_MAX_AGE_SECONDS}; Path=/; SameSite=Lax${secure}`;
    router.push(`${localizePath(pathname, nextLocale)}${window.location.search}`);
  }

  return (
    <label className="relative shrink-0">
      <span className="sr-only">{label}</span>
      <select
        aria-label={label}
        value={locale}
        onChange={(event) => chooseLocale(event.target.value as Locale)}
        className="min-h-10 max-w-32 appearance-none rounded-xl border border-[var(--line-strong)] bg-white py-2 ps-3 pe-8 text-sm font-bold text-[var(--brand-strong)] outline-none focus:border-[var(--brand)]"
      >
        {(Object.entries(LOCALE_NAMES) as [Locale, string][]).map(
          ([value, name]) => (
            <option key={value} value={value}>
              {name}
            </option>
          ),
        )}
      </select>
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-y-0 end-2.5 flex items-center text-xs text-[var(--brand-strong)]"
      >
        ▾
      </span>
    </label>
  );
}
