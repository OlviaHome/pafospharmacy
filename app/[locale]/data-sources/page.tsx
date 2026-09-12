import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { LocalizedContentPage } from "@/components/localized-content-page";
import { isLocale } from "@/lib/i18n/config";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { contentPageMetadata } from "@/lib/i18n/metadata";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  return contentPageMetadata(locale, "/data-sources", getDictionary(locale).pages.dataSources);
}

export default async function DataSourcesPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const dictionary = getDictionary(locale);
  return <LocalizedContentPage locale={locale} dictionary={dictionary} page={dictionary.pages.dataSources} />;
}
