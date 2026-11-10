import Link from "next/link";
import { Fragment } from "react";

import { LOCALE_NAMES, LOCALE_SHORT_NAMES } from "@/lib/i18n/config";
import type { BlogTranslation } from "@/lib/blog/types";
import type { BlogMessages, Locale } from "@/lib/i18n/types";

const STATUS_KEY = {
  draft: "statusDraft",
  review: "statusReview",
  published: "statusPublished",
} as const;

/**
 * Compact "EN | ΕΛ | РУ | عربي" switch, each label in its own language.
 * It changes only the article language (?lang=xx); the site language stays as it is.
 */
export function ArticleLanguageBadges({
  basePath,
  siteLocale,
  currentLocale,
  translations,
  messages,
  showStatus,
}: {
  basePath: string;
  siteLocale: Locale;
  currentLocale: Locale;
  translations: Pick<BlogTranslation, "locale" | "status">[];
  messages: BlogMessages;
  showStatus: boolean;
}) {
  if (translations.length < 2 && !showStatus) return null;
  return (
    <nav aria-label={messages.articleLanguages} className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <span className="text-xs font-semibold text-[var(--ink-muted)]">{messages.articleLanguages}</span>
      <span
        dir="ltr"
        className="inline-flex items-center rounded-full border border-[var(--line-strong)] bg-white p-0.5 text-sm"
      >
        {translations.map(({ locale, status }, index) => {
          const active = locale === currentLocale;
          const href = locale === siteLocale ? basePath : `${basePath}?lang=${locale}`;
          return (
            <Fragment key={locale}>
              {index > 0 && (
                <span aria-hidden="true" className="px-0.5 text-[var(--line-strong)]">
                  |
                </span>
              )}
              <Link
                href={href}
                hrefLang={locale}
                lang={locale}
                title={LOCALE_NAMES[locale]}
                aria-label={LOCALE_NAMES[locale]}
                aria-current={active ? "true" : undefined}
                scroll={false}
                className={`inline-flex min-h-9 min-w-11 items-center justify-center gap-1 rounded-full px-3 font-bold transition-colors ${
                  active
                    ? "bg-[var(--brand)] text-white"
                    : "text-[var(--brand-strong)] hover:bg-[var(--surface-muted)]"
                }`}
              >
                {LOCALE_SHORT_NAMES[locale]}
                {showStatus && (
                  <span className={`text-[0.65rem] font-semibold ${active ? "text-white/75" : "text-[var(--ink-muted)]"}`}>
                    {messages[STATUS_KEY[status]]}
                  </span>
                )}
              </Link>
            </Fragment>
          );
        })}
      </span>
    </nav>
  );
}
