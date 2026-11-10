"use client";

import { Plus } from "lucide-react";
import Link from "next/link";

import { LanguageSelector } from "@/components/language-selector";
import { localePath } from "@/lib/i18n/config";
import type { Locale } from "@/lib/i18n/types";

export function FinderHeader({
  locale,
  brandName,
  blog,
  about,
  dataSources,
  languageLabel,
}: {
  locale: Locale;
  brandName: string;
  blog: string;
  about: string;
  dataSources: string;
  languageLabel: string;
}) {
  return (
    <header className="sticky top-0 z-50 border-b border-black/5 bg-white/85 shadow-[0_1px_12px_rgba(16,15,15,0.04)] backdrop-blur-xl supports-[backdrop-filter]:bg-white/75">
      <div className="mx-auto flex min-h-14 w-full max-w-7xl items-center gap-3 px-4 sm:min-h-16 sm:px-6 lg:px-8">
        <Link
          href={localePath(locale)}
          className="flex min-w-0 flex-1 items-center gap-3"
        >
          <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-[var(--brand)] text-white">
            <Plus className="size-6 stroke-[3]" aria-hidden="true" />
          </span>
          <span className="min-w-0 text-lg font-extrabold tracking-[-0.025em] text-[var(--ink)] sm:text-xl">
            {brandName}
          </span>
        </Link>
        <Link
          href={localePath(locale, "/blog")}
          className="hidden min-h-11 min-w-11 items-center justify-center text-sm font-bold text-[var(--ink-muted)] hover:text-[var(--brand)] sm:inline-flex"
        >
          {blog}
        </Link>
        <Link
          href={localePath(locale, "/about")}
          className="hidden min-h-11 min-w-11 items-center justify-center text-sm font-bold text-[var(--ink-muted)] hover:text-[var(--brand)] sm:inline-flex"
        >
          {about}
        </Link>
        <Link
          href={localePath(locale, "/data-sources")}
          className="hidden min-h-11 min-w-11 items-center justify-center text-sm font-bold text-[var(--ink-muted)] hover:text-[var(--brand)] md:inline-flex"
        >
          {dataSources}
        </Link>
        <LanguageSelector locale={locale} label={languageLabel} />
      </div>
      <nav
        aria-label={`${blog} / ${about} / ${dataSources}`}
        className="mx-auto flex min-h-11 w-full max-w-7xl items-center gap-5 border-t border-[var(--line)] px-4 text-xs font-bold text-[var(--ink-muted)] sm:px-6 md:hidden"
      >
        <Link
          href={localePath(locale, "/blog")}
          className="inline-flex min-h-11 min-w-11 items-center justify-center sm:hidden"
        >
          {blog}
        </Link>
        <Link
          href={localePath(locale, "/about")}
          className="inline-flex min-h-11 min-w-11 items-center justify-center sm:hidden"
        >
          {about}
        </Link>
        <Link
          href={localePath(locale, "/data-sources")}
          className="inline-flex min-h-11 min-w-11 items-center justify-center"
        >
          {dataSources}
        </Link>
      </nav>
    </header>
  );
}
