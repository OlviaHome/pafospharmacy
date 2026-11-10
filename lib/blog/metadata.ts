import type { Metadata } from "next";

import { localePath } from "@/lib/i18n/config";
import { metadataBase } from "@/lib/i18n/metadata";
import type { TranslationDictionary } from "@/lib/i18n/types";

import { findImage, imageAlt, seoTitle, translationLocales } from "./content";
import type { BlogPost, BlogTranslation } from "./types";

export function blogPostPath(locale: BlogTranslation["locale"], slug: string): string {
  return localePath(locale, `/blog/${slug}`);
}

/**
 * The canonical URL of a version is always its own locale page, so
 * /ru/blog/x?lang=en and /ar/blog/x (English fallback) both point to /en/blog/x.
 */
export function blogArticleMetadata(
  post: BlogPost,
  translation: BlogTranslation,
  siteDictionary: TranslationDictionary,
): Metadata {
  const locales = translationLocales(post);
  const cover = findImage(post, "cover");
  const xDefault = locales.includes("en") ? "en" : locales[0];
  return {
    metadataBase,
    title: seoTitle(translation.title, siteDictionary.siteTitle),
    description: translation.description,
    alternates: {
      canonical: blogPostPath(translation.locale, post.slug),
      languages: {
        ...Object.fromEntries(locales.map((locale) => [locale, blogPostPath(locale, post.slug)])),
        ...(xDefault ? { "x-default": blogPostPath(xDefault, post.slug) } : {}),
      },
    },
    openGraph: {
      type: "article",
      title: translation.title,
      description: translation.description,
      url: blogPostPath(translation.locale, post.slug),
      locale: translation.locale,
      publishedTime: translation.publishedAt ?? post.publishedAt ?? undefined,
      modifiedTime: translation.updatedAt,
      authors: [post.authorName],
      images: cover?.url
        ? [
            {
              url: cover.url,
              width: cover.width ?? undefined,
              height: cover.height ?? undefined,
              alt: imageAlt(cover, translation.locale),
            },
          ]
        : undefined,
    },
    twitter: {
      card: cover?.url ? "summary_large_image" : "summary",
      title: translation.title,
      description: translation.description,
      images: cover?.url ? [cover.url] : undefined,
    },
  };
}
