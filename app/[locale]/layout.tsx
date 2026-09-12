import type { Metadata, Viewport } from "next";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import { SiteFooter } from "@/components/site-footer";
import { getDictionary } from "@/lib/i18n/dictionaries";
import {
  isLocale,
  localeDirection,
  SUPPORTED_LOCALES,
} from "@/lib/i18n/config";
import { metadataBase } from "@/lib/i18n/metadata";

import "../globals.css";

export function generateStaticParams() {
  return SUPPORTED_LOCALES.map((locale) => ({ locale }));
}

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
    applicationName: "Paphos Pharmacy",
    manifest: "/manifest.webmanifest",
    icons: { icon: "/icon.svg", apple: "/icon.svg" },
    openGraph: {
      title: dictionary.siteTitle,
      description: dictionary.metadataDescription,
      type: "website",
      locale,
      images: [{ url: "/og.png", width: 1734, height: 907, alt: "Paphos Pharmacy" }],
    },
  };
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#08785f",
};

export default async function LocaleLayout({
  children,
  params,
}: Readonly<{ children: ReactNode; params: Promise<{ locale: string }> }>) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const dictionary = getDictionary(locale);

  return (
    <html lang={locale} dir={localeDirection(locale)}>
      <body>
        {children}
        <SiteFooter locale={locale} messages={dictionary.footer} />
      </body>
    </html>
  );
}
