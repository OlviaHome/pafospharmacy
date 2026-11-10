import type { MetadataRoute } from "next";

import { translationLocales } from "@/lib/blog/content";
import { blogPostPath } from "@/lib/blog/metadata";
import { getPublishedPosts } from "@/lib/blog/repository";
import type { BlogPost } from "@/lib/blog/types";
import { localePath, SUPPORTED_LOCALES } from "@/lib/i18n/config";
import { metadataBase } from "@/lib/i18n/metadata";

export const revalidate = 3600;

const PAGES = [
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
  const pages = PAGES.flatMap(({ pathname, changeFrequency, priority }) => {
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

  let posts: BlogPost[] = [];
  try {
    posts = await getPublishedPosts();
  } catch (error) {
    // The static pages must stay discoverable even if the blog query fails.
    console.error("sitemap: could not load blog posts", error);
  }
  return [...pages, ...blogEntries(posts)];
}
