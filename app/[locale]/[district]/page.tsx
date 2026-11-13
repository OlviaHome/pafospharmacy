import type { Metadata, ResolvingMetadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";

import { PharmacyFinder } from "@/components/pharmacy-finder";
import { getPharmacyDataset } from "@/lib/data/pharmacies";
import { isLocale, localePath, SUPPORTED_LOCALES } from "@/lib/i18n/config";
import { DISTRICT_BY_SLUG, districtPageCopy, isDistrictSlug } from "@/lib/i18n/district-pages";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { metadataBase } from "@/lib/i18n/metadata";

type Params = { params: Promise<{ locale: string; district: string }> };

export async function generateMetadata({ params }: Params, parent: ResolvingMetadata): Promise<Metadata> {
  const { locale, district } = await params;
  if (!isLocale(locale) || !isDistrictSlug(district)) return {};
  const { title, description } = districtPageCopy(locale, district);
  const parentMetadata = await parent;
  const pathname = `/${district}`;
  return {
    metadataBase,
    title,
    description,
    alternates: {
      canonical: localePath(locale, pathname),
      languages: {
        ...Object.fromEntries(SUPPORTED_LOCALES.map((language) => [language, localePath(language, pathname)])),
        "x-default": localePath("en", pathname),
      },
    },
    openGraph: { ...parentMetadata.openGraph, title, description },
    twitter: { ...parentMetadata.twitter, title, description },
  };
}

export default async function DistrictPage({ params }: Params) {
  const { locale, district } = await params;
  if (!isLocale(locale) || !isDistrictSlug(district)) notFound();
  await connection();
  const dataset = await getPharmacyDataset(new Date());
  const selectedDistrict = DISTRICT_BY_SLUG[district];
  const dictionary = getDictionary(locale);
  return (
    <PharmacyFinder
      key={district}
      {...dataset}
      pharmacies={dataset.pharmacies.filter((pharmacy) => pharmacy.district === selectedDistrict)}
      locale={locale}
      messages={dictionary.finder}
      languageLabel={dictionary.languageSelectorLabel}
      initialDistrict={selectedDistrict}
      districtPage
      heroTitle={districtPageCopy(locale, district).h1}
    />
  );
}
