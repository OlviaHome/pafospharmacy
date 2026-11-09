import type { MetadataRoute } from "next";

import { localePath, SUPPORTED_LOCALES } from "@/lib/i18n/config";
import { metadataBase } from "@/lib/i18n/metadata";

const PAGES = [
  { pathname: "", changeFrequency: "daily", priority: 1 },
  { pathname: "/about", changeFrequency: "monthly", priority: 0.5 },
  { pathname: "/data-sources", changeFrequency: "monthly", priority: 0.5 },
  { pathname: "/privacy", changeFrequency: "yearly", priority: 0.2 },
  { pathname: "/terms", changeFrequency: "yearly", priority: 0.2 },
] as const;

function absolute(path: string): string {
  return new URL(path, metadataBase).toString();
}

export default function sitemap(): MetadataRoute.Sitemap {
  return PAGES.flatMap(({ pathname, changeFrequency, priority }) => {
    const languages = Object.fromEntries(
      SUPPORTED_LOCALES.map((locale) => [locale, absolute(localePath(locale, pathname))]),
    );
    return SUPPORTED_LOCALES.map((locale) => ({
      url: absolute(localePath(locale, pathname)),
      changeFrequency,
      priority,
      alternates: { languages },
    }));
  });
}
