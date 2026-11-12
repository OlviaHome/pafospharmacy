import type { Metadata, ResolvingMetadata } from "next";
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

const HOME_METADATA: Record<Locale, { title: string; description: string }> = {
  en: {
    title: "Pharmacies in Cyprus: On Duty Today & Open Now | HealthGuide.cy",
    description:
      "Find pharmacies on duty today and open now in Nicosia, Limassol, Larnaca, Paphos and Famagusta: phones, hours and directions from official data.",
  },
  el: {
    title: "Διανυκτερεύοντα Φαρμακεία Κύπρου Σήμερα | HealthGuide.cy",
    description:
      "Διανυκτερεύοντα και διημερεύοντα φαρμακεία σε Λευκωσία, Λεμεσό, Λάρνακα, Πάφο και Αμμόχωστο: τηλέφωνα, ωράριο και οδηγίες από επίσημα στοιχεία.",
  },
  ru: {
    title: "Дежурные аптеки Кипра сегодня — открытые сейчас | HealthGuide.cy",
    description:
      "Какие аптеки дежурят сегодня в Никосии, Лимассоле, Ларнаке, Пафосе и Фамагусте: телефоны, часы работы и маршрут. Данные официальных источников.",
  },
  ar: {
    title: "الصيدليات المناوبة في قبرص اليوم | مفتوحة الآن | HealthGuide.cy",
    description:
      "الصيدليات المناوبة اليوم في نيقوسيا وليماسول ولارنكا وبافوس وفاماغوستا، مع أرقام الهاتف وساعات العمل والاتجاهات من بيانات رسمية.",
  },
};

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}, parent: ResolvingMetadata): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  const { title, description } = HOME_METADATA[locale];
  const parentMetadata = await parent;
  return {
    metadataBase,
    title,
    description,
    alternates: localizedAlternates(locale),
    openGraph: { ...parentMetadata.openGraph, title, description },
    twitter: { ...parentMetadata.twitter, title, description },
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
