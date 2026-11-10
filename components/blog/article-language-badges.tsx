import Link from "next/link";

import { LOCALE_NAMES } from "@/lib/i18n/config";
import type { BlogTranslation } from "@/lib/blog/types";
import type { BlogMessages, Locale } from "@/lib/i18n/types";

const STATUS_KEY = {
  draft: "statusDraft",
  review: "statusReview",
  published: "statusPublished",
} as const;

/**
 * Lets a reader switch only the article language (?lang=xx) without switching the site.
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
    <nav aria-label={messages.articleLanguages} className="flex flex-wrap items-center gap-2">
      <span className="me-1 text-xs font-semibold text-[var(--ink-muted)]">
        {messages.articleLanguages}:
      </span>
      {translations.map(({ locale, status }) => {
        const active = locale === currentLocale;
        const href = locale === siteLocale ? basePath : `${basePath}?lang=${locale}`;
        return (
          <Link
            key={locale}
            href={href}
            hrefLang={locale}
            lang={locale}
            aria-current={active ? "true" : undefined}
            scroll={false}
            className={`inline-flex min-h-9 items-center gap-1.5 rounded-full border px-3 text-xs font-bold transition-colors ${
              active
                ? "border-[var(--brand)] bg-[var(--brand)] text-white"
                : "border-[var(--line-strong)] bg-white text-[var(--brand-strong)] hover:border-[var(--brand)]"
            }`}
          >
            {LOCALE_NAMES[locale]}
            {showStatus && (
              <span className={active ? "text-white/75" : "text-[var(--ink-muted)]"}>
                · {messages[STATUS_KEY[status]]}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
