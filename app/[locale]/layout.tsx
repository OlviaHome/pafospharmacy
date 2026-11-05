import type { Metadata, Viewport } from "next";
import { Instrument_Sans } from "next/font/google";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { Analytics } from "@vercel/analytics/next";

import { SiteFooter } from "@/components/site-footer";
import { getDictionary } from "@/lib/i18n/dictionaries";
import {
  isLocale,
  localeDirection,
  SUPPORTED_LOCALES,
} from "@/lib/i18n/config";
import { metadataBase } from "@/lib/i18n/metadata";

import "../globals.css";

const instrumentSans = Instrument_Sans({
  subsets: ["latin", "latin-ext"],
  weight: ["400", "500", "600"],
  style: "normal",
  display: "swap",
  variable: "--font-instrument-sans",
});

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
    applicationName: "Cyprus Pharmacy",
    manifest: "/manifest.webmanifest",
    icons: { icon: "/icon.svg", apple: "/icon.svg" },
    openGraph: {
      title: dictionary.siteTitle,
      description: dictionary.metadataDescription,
      type: "website",
      locale,
      images: [{ url: "/og.png", width: 1734, height: 907, alt: "Cyprus Pharmacy" }],
    },
  };
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0f3d3e",
};

export default async function LocaleLayout({
  children,
  params,
}: Readonly<{ children: ReactNode; params: Promise<{ locale: string }> }>) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const dictionary = getDictionary(locale);

  return (
    <html
      lang={locale}
      dir={localeDirection(locale)}
      className={instrumentSans.variable}
    >
      <body>
        {children}
        <SiteFooter locale={locale} messages={dictionary.footer} />
        <Analytics />
      </body>
    </html>
  );
}
