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
 * Plain "EN | ΕΛ | РУ | عربي" text switch, each label in its own language: the current one
 * is bolder and darker, others get a green underline on hover.
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
    <nav aria-label={messages.articleLanguages} className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
      <span className="text-xs font-semibold text-[var(--ink-muted)]">{messages.articleLanguages}:</span>
      <span dir="ltr" className="inline-flex flex-wrap items-baseline text-sm">
        {translations.map(({ locale, status }, index) => {
          const active = locale === currentLocale;
          const href = locale === siteLocale ? basePath : `${basePath}?lang=${locale}`;
          return (
            <Fragment key={locale}>
              {index > 0 && (
                <span aria-hidden="true" className="mx-2.5 text-[var(--line-strong)]">
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
                className={`inline-block py-2 underline-offset-[6px] decoration-2 ${
                  active
                    ? "font-extrabold text-[var(--ink)]"
                    : "font-normal text-[var(--ink-muted)] hover:text-[var(--ink)] hover:underline hover:decoration-[var(--link-hover)] focus-visible:underline focus-visible:decoration-[var(--link-hover)]"
                }`}
              >
                {LOCALE_SHORT_NAMES[locale]}
                {showStatus && (
                  <span className="ms-1 inline-block text-[0.65rem] font-semibold text-[var(--ink-muted)]">
                    ({messages[STATUS_KEY[status]]})
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
