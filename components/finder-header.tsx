"use client";

import { usePathname } from "next/navigation";
import { hospitalMessages } from "@/lib/hospitals/messages";
import { DISTRICT_SLUGS } from "@/lib/i18n/district-pages";
import Image from "next/image";
import Link from "next/link";

import { LanguageSelector } from "@/components/language-selector";
import { localePath } from "@/lib/i18n/config";
import type { Locale } from "@/lib/i18n/types";

export function FinderHeader({
  locale,
  brandName,
  pharmacies,
  blog,
  about,
  dataSources,
  languageLabel,
}: {
  locale: Locale;
  brandName: string;
  pharmacies: string;
  blog: string;
  about: string;
  dataSources: string;
  languageLabel: string;
}) {
  const pathname = usePathname();
  const district = pathname.split("/")[2];
  // Section of the current page; district pages are part of the Pharmacies catalogue.
  const section = pathname.split("/")[2] ?? "";
  const isDistrict = DISTRICT_SLUGS.includes(section as typeof DISTRICT_SLUGS[number]);
  const active = section === "" || isDistrict ? "pharmacies" : section;
  const current = (key: string) => (active === key ? ("page" as const) : undefined);
  const tone = (key: string) =>
    active === key
      ? "text-[var(--brand-strong)]"
      : "text-[var(--ink-muted)] hover:text-[var(--brand)]";
  const hospitalsHref = localePath(locale, "/hospitals") + (DISTRICT_SLUGS.includes(district as typeof DISTRICT_SLUGS[number]) ? `?district=${district}` : "");
  return (
    <header className="sticky top-0 z-50 border-b border-black/5 bg-white/85 shadow-[0_1px_12px_rgba(16,15,15,0.04)] backdrop-blur-xl supports-[backdrop-filter]:bg-white/75">
      <div className="mx-auto flex min-h-14 w-full max-w-7xl items-center gap-3 px-4 sm:min-h-16 sm:px-6 lg:px-8">
        <Link
          href={localePath(locale)}
          className="flex min-w-0 flex-1 items-center gap-3"
        >
          <Image
            src="/logo-pin.png"
            alt=""
            width={121}
            height={160}
            priority
            className="h-9 w-auto shrink-0 sm:h-10"
          />
          <span className="min-w-0 text-base font-extrabold leading-tight tracking-[-0.025em] text-[var(--ink)] sm:text-xl">
            {brandName}
          </span>
        </Link>
        <Link
          href={localePath(locale)}
          aria-current={current("pharmacies")}
          className={`hidden min-h-11 items-center text-sm font-bold md:inline-flex ${tone("pharmacies")}`}
        >
          {pharmacies}
        </Link>
        <Link
          href={hospitalsHref}
          aria-current={current("hospitals")}
          className={`hidden min-h-11 items-center text-sm font-bold md:inline-flex ${tone("hospitals")}`}
        >
          {hospitalMessages[locale].menu}
        </Link>
        <Link
          href={localePath(locale, "/blog")}
          aria-current={current("blog")}
          className={`hidden min-h-11 min-w-11 items-center justify-center text-sm font-bold md:inline-flex ${tone("blog")}`}
        >
          {blog}
        </Link>
        <Link
          href={localePath(locale, "/about")}
          aria-current={current("about")}
          className={`hidden min-h-11 min-w-11 items-center justify-center text-sm font-bold md:inline-flex ${tone("about")}`}
        >
          {about}
        </Link>
        <Link
          href={localePath(locale, "/data-sources")}
          aria-current={current("data-sources")}
          className={`hidden min-h-11 min-w-11 items-center justify-center text-sm font-bold md:inline-flex ${tone("data-sources")}`}
        >
          {dataSources}
        </Link>
        <LanguageSelector locale={locale} label={languageLabel} />
      </div>
      <nav
        aria-label={`${pharmacies} / ${hospitalMessages[locale].menu} / ${blog} / ${about} / ${dataSources}`}
        className="mx-auto flex flex-wrap min-h-11 w-full max-w-7xl items-center gap-x-3 border-t border-[var(--line)] px-4 text-xs font-bold sm:px-6 md:hidden"
      >
        <Link
          href={localePath(locale)}
          aria-current={current("pharmacies")}
          className={`inline-flex min-h-11 items-center ${tone("pharmacies")}`}
        >
          {pharmacies}
        </Link>
        <Link
          href={hospitalsHref}
          aria-current={current("hospitals")}
          className={`inline-flex min-h-11 items-center ${tone("hospitals")}`}
        >
          {hospitalMessages[locale].menu}
        </Link>
        <Link
          href={localePath(locale, "/blog")}
          aria-current={current("blog")}
          className={`inline-flex min-h-11 min-w-11 items-center justify-center ${tone("blog")}`}
        >
          {blog}
        </Link>
        <Link
          href={localePath(locale, "/about")}
          aria-current={current("about")}
          className={`inline-flex min-h-11 min-w-11 items-center justify-center ${tone("about")}`}
        >
          {about}
        </Link>
        <Link
          href={localePath(locale, "/data-sources")}
          aria-current={current("data-sources")}
          className={`inline-flex min-h-11 min-w-11 items-center justify-center ${tone("data-sources")}`}
        >
          {dataSources}
        </Link>
      </nav>
    </header>
  );
}
