import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";

import { PharmacyFinder } from "@/components/pharmacy-finder";
import { getPharmacyDataset } from "@/lib/data/pharmacies";
import { isLocale } from "@/lib/i18n/config";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { localizedAlternates, metadataBase } from "@/lib/i18n/metadata";
import type { Locale, TranslationDictionary } from "@/lib/i18n/types";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  const dictionary = getDictionary(locale);
  return {
    metadataBase,
    title: dictionary.siteTitle,
    description: dictionary.metadataDescription,
    alternates: localizedAlternates(locale),
  };
}

async function PharmacyFinderData({
  locale,
  dictionary,
}: {
  locale: Locale;
  dictionary: TranslationDictionary;
}) {
  await connection();
  const dataset = await getPharmacyDataset(new Date());
  return (
    <PharmacyFinder
      {...dataset}
      locale={locale}
      messages={dictionary.finder}
      languageLabel={dictionary.languageSelectorLabel}
    />
  );
}

function LoadingFinder({ dictionary }: { dictionary: TranslationDictionary }) {
  return (
    <main className="mx-auto min-h-screen w-full max-w-3xl px-4 py-5 sm:px-6 sm:py-8">
      <header className="mb-5">
        <h1 className="text-xl font-extrabold text-[var(--ink)]">Paphos Pharmacy</h1>
        <p className="mt-1 text-sm text-[var(--ink-muted)]">{dictionary.finder.heroDescription}</p>
      </header>
      <div className="h-44 animate-pulse rounded-3xl border border-[var(--line)] bg-[var(--surface)]" />
      <p className="mt-5 text-sm font-semibold text-[var(--ink-muted)]">{dictionary.finder.loading}</p>
    </main>
  );
}

export default async function Home({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const dictionary = getDictionary(locale);
  return (
    <Suspense fallback={<LoadingFinder dictionary={dictionary} />}>
      <PharmacyFinderData locale={locale} dictionary={dictionary} />
    </Suspense>
  );
}
