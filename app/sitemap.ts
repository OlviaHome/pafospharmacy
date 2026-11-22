import type { MetadataRoute } from "next";

import { translationLocales } from "@/lib/blog/content";
import { blogPostPath } from "@/lib/blog/metadata";
import { getPublishedPosts } from "@/lib/blog/repository";
import { getPharmacyDataset } from "@/lib/data/pharmacies";
import { dutyRosterLastmodByDistrict } from "@/lib/domain/duty-lastmod";
import type { BlogPost } from "@/lib/blog/types";
import { localePath, SUPPORTED_LOCALES } from "@/lib/i18n/config";
import { DISTRICT_BY_SLUG, DISTRICT_SLUGS } from "@/lib/i18n/district-pages";
import { metadataBase } from "@/lib/i18n/metadata";

export const revalidate = 3600;

const PAGES = [
  { pathname: "/hospitals", changeFrequency: "monthly", priority: 0.7 },
  { pathname: "", changeFrequency: "daily", priority: 1 },
  { pathname: "/blog", changeFrequency: "weekly", priority: 0.7 },
  { pathname: "/about", changeFrequency: "monthly", priority: 0.5 },
  { pathname: "/data-sources", changeFrequency: "monthly", priority: 0.5 },
  { pathname: "/privacy", changeFrequency: "yearly", priority: 0.2 },
  { pathname: "/terms", changeFrequency: "yearly", priority: 0.2 },
] as const;

function absolute(path: string): string {
  return new URL(path, metadataBase).toString();
}

function blogEntries(posts: BlogPost[]): MetadataRoute.Sitemap {
  return posts.flatMap((post) => {
    const locales = translationLocales(post);
    const languages = Object.fromEntries(
      locales.map((locale) => [locale, absolute(blogPostPath(locale, post.slug))]),
    );
    return post.translations.map((translation) => ({
      url: absolute(blogPostPath(translation.locale, post.slug)),
      lastModified: translation.updatedAt,
      changeFrequency: "monthly" as const,
      priority: 0.6,
      alternates: { languages },
    }));
  });
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  // Today's duty roster is already included in the server-rendered pharmacy pages.
  // Reuse that dataset and report lastmod only for districts where the roster
  // changed from yesterday. Do not change dates merely because sitemap ran.
  const now = new Date();
  let dutyLastModified = new Map<string, Date>();
  try {
    const dataset = await getPharmacyDataset(now);
    dutyLastModified = dutyRosterLastmodByDistrict(dataset.pharmacies, now);
  } catch (error) {
    // A temporary pharmacy-data failure must not hide the sitemap itself.
    console.error("sitemap: could not determine duty updates", error);
  }

  const pages = PAGES.flatMap(({ pathname, changeFrequency, priority }) => {
    const languages = Object.fromEntries(
      SUPPORTED_LOCALES.map((locale) => [locale, absolute(localePath(locale, pathname))]),
    );
    const lastModified = pathname === "" ? dutyLastModified.get("Paphos") : undefined;
    return SUPPORTED_LOCALES.map((locale) => ({
      url: absolute(localePath(locale, pathname)),
      ...(lastModified ? { lastModified } : {}),
      changeFrequency,
      priority,
      alternates: { languages },
    }));
  });

  const districtPages = DISTRICT_SLUGS.flatMap((district) => {
    const pathname = `/${district}`;
    const languages = Object.fromEntries(
      SUPPORTED_LOCALES.map((locale) => [locale, absolute(localePath(locale, pathname))]),
    );
    const lastModified = dutyLastModified.get(DISTRICT_BY_SLUG[district]);
    return SUPPORTED_LOCALES.map((locale) => ({
      url: absolute(localePath(locale, pathname)),
      ...(lastModified ? { lastModified } : {}),
      changeFrequency: "daily" as const,
      priority: 0.8,
      alternates: { languages },
    }));
  });

  let posts: BlogPost[] = [];
  try {
    posts = await getPublishedPosts();
  } catch (error) {
    // The static pages must stay discoverable even if the blog query fails.
    console.error("sitemap: could not load blog posts", error);
  }
  return [...pages, ...districtPages, ...blogEntries(posts)];
}
