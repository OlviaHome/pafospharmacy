import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";

import { BlogArticle } from "@/components/blog/blog-article";
import { BlogShell } from "@/components/blog/blog-shell";
import { chooseTranslation } from "@/lib/blog/content";
import { getPreviewPost } from "@/lib/blog/repository";
import { isLocale, localePath } from "@/lib/i18n/config";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { metadataBase } from "@/lib/i18n/metadata";

type Params = Promise<{ locale: string; token: string }>;
type SearchParams = Promise<{ lang?: string | string[] }>;

export const metadata: Metadata = {
  metadataBase,
  title: "Preview",
  robots: { index: false, follow: false, nocache: true },
  referrer: "no-referrer",
};

/** Hidden editor preview of a draft in any status. Linked only from the editorial bot. */
export default async function BlogPreviewPage({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: SearchParams;
}) {
  await connection();
  const { locale, token } = await params;
  if (!isLocale(locale)) notFound();
  const post = await getPreviewPost(token);
  if (!post) notFound();
  const lang = (await searchParams).lang;
  const chosen = chooseTranslation(post, locale, typeof lang === "string" ? lang : null);
  if (!chosen) notFound();
  const siteDictionary = getDictionary(locale);

  return (
    <BlogShell dictionary={siteDictionary}>
      <BlogArticle
        post={post}
        chosen={chosen}
        siteDictionary={siteDictionary}
        contentDictionary={getDictionary(chosen.translation.locale)}
        basePath={localePath(locale, `/blog/preview/${token}`)}
        preview
      />
    </BlogShell>
  );
}
