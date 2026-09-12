import Link from "next/link";
import type { ReactNode } from "react";

import { LanguageSelector } from "@/components/language-selector";
import { localePath } from "@/lib/i18n/config";
import type { Locale } from "@/lib/i18n/types";

export function InformationPage({
  title,
  introduction,
  locale,
  languageLabel,
  backLabel,
  lastUpdated,
  children,
}: {
  title: string;
  introduction: string;
  locale: Locale;
  languageLabel: string;
  backLabel: string;
  lastUpdated: string;
  children: ReactNode;
}) {
  return (
    <main className="mx-auto min-h-[70vh] w-full max-w-3xl px-4 py-7 sm:px-6 sm:py-10">
      <div className="flex items-center justify-between gap-4">
        <Link
          href={localePath(locale)}
          className="text-sm font-bold text-[var(--brand-strong)] underline decoration-[var(--line-strong)] underline-offset-4"
        >
          {backLabel}
        </Link>
        <LanguageSelector locale={locale} label={languageLabel} />
      </div>
      <header className="mt-6 border-b border-[var(--line)] pb-6">
        <p className="text-xs font-extrabold uppercase tracking-[0.15em] text-[var(--brand)]">
          Paphos Pharmacy
        </p>
        <h1 className="mt-2 text-3xl font-extrabold tracking-[-0.035em] text-[var(--ink)]">
          {title}
        </h1>
        <p className="mt-3 max-w-2xl text-base leading-7 text-[var(--ink-muted)]">
          {introduction}
        </p>
        <p className="mt-3 text-xs font-semibold text-[var(--ink-muted)]">{lastUpdated}</p>
      </header>
      <div className="space-y-8 py-7 text-sm leading-7 text-[var(--ink)] sm:text-base">
        {children}
      </div>
    </main>
  );
}
