import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";

import { LoadingFinder } from "@/components/loading-finder";
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
