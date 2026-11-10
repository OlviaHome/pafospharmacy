import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { BlogArticle } from "@/components/blog/blog-article";
import { BlogJsonLd } from "@/components/blog/blog-json-ld";
import { BlogShell } from "@/components/blog/blog-shell";
import { chooseTranslation } from "@/lib/blog/content";
import { blogArticleMetadata, blogPostPath } from "@/lib/blog/metadata";
import { getPublishedPost } from "@/lib/blog/repository";
import { isLocale } from "@/lib/i18n/config";
import { getDictionary } from "@/lib/i18n/dictionaries";

type Params = Promise<{ locale: string; slug: string }>;
type SearchParams = Promise<{ lang?: string | string[] }>;

function requestedLang(value: string | string[] | undefined): string | null {
  return typeof value === "string" ? value : null;
}

export async function generateMetadata({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: SearchParams;
}): Promise<Metadata> {
  const { locale, slug } = await params;
  if (!isLocale(locale)) return {};
  const post = await getPublishedPost(slug);
  if (!post) return {};
  const chosen = chooseTranslation(post, locale, requestedLang((await searchParams).lang));
  if (!chosen) return {};
  return blogArticleMetadata(post, chosen.translation, getDictionary(locale));
}

export default async function BlogPostPage({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: SearchParams;
}) {
  const { locale, slug } = await params;
  if (!isLocale(locale)) notFound();
  const post = await getPublishedPost(slug);
  if (!post) notFound();
  const chosen = chooseTranslation(post, locale, requestedLang((await searchParams).lang));
  if (!chosen) notFound();
  const siteDictionary = getDictionary(locale);

  return (
    <BlogShell dictionary={siteDictionary}>
      <BlogJsonLd post={post} translation={chosen.translation} />
      <BlogArticle
        post={post}
        chosen={chosen}
        siteDictionary={siteDictionary}
        contentDictionary={getDictionary(chosen.translation.locale)}
        basePath={blogPostPath(locale, post.slug)}
        preview={false}
      />
    </BlogShell>
  );
}
