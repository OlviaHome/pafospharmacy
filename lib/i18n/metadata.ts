import type { Metadata } from "next";

import { localePath, SUPPORTED_LOCALES } from "./config";
import type { ContentPageMessages, Locale } from "./types";

const PRODUCTION_URL = "https://pafospharmacy.vercel.app";

export const metadataBase = new URL(process.env.SITE_URL ?? PRODUCTION_URL);

export function localizedAlternates(locale: Locale, pathname = "") {
  return {
    canonical: localePath(locale, pathname),
    languages: {
      ...Object.fromEntries(
        SUPPORTED_LOCALES.map((value) => [value, localePath(value, pathname)]),
      ),
      "x-default": "/",
    },
  } satisfies Metadata["alternates"];
}

export function contentPageMetadata(
  locale: Locale,
  pathname: string,
  page: ContentPageMessages,
): Metadata {
  return {
    metadataBase,
    title: `${page.title} | Paphos Pharmacy`,
    description: page.description,
    alternates: localizedAlternates(locale, pathname),
  };
}
