import { Newspaper } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";

import { FeaturedPostCard, PostCard, type BlogIndexEntry } from "@/components/blog/blog-index-cards";
import { BlogShell } from "@/components/blog/blog-shell";
import { chooseTranslation } from "@/lib/blog/content";
import { getPublishedPosts } from "@/lib/blog/repository";
import { isLocale } from "@/lib/i18n/config";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { localizedAlternates, metadataBase } from "@/lib/i18n/metadata";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  const dictionary = getDictionary(locale);
  return {
    metadataBase,
    title: dictionary.blog.title,
    description: dictionary.blog.description,
    alternates: localizedAlternates(locale, "/blog"),
  };
}

export default async function BlogIndexPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const dictionary = getDictionary(locale);
  const messages = dictionary.blog;
  // Rendered per request so deploys never depend on the database; the query itself is cached.
  await connection();
  const posts = await getPublishedPosts();

  const entries = posts.flatMap((post): BlogIndexEntry[] => {
    const chosen = chooseTranslation(post, locale);
    return chosen ? [{ post, translation: chosen.translation }] : [];
  });
  const [featured, ...rest] = entries;

  return (
    <BlogShell dictionary={dictionary}>
      <div className="mx-auto w-full max-w-[1100px] px-4 sm:px-6">
        <header className="pb-10 pt-12 sm:pb-12 sm:pt-16">
          <p className="text-xs font-bold uppercase tracking-[0.15em] text-[var(--brand)]">
            <bdi>{messages.eyebrow}</bdi>
          </p>
          <h1 className="mt-4 max-w-3xl text-balance text-[clamp(2.5rem,6vw,4.25rem)] font-extrabold leading-[1.05] tracking-[-0.04em] text-[var(--ink)]">
            {messages.heading}
          </h1>
          <p className="mt-5 max-w-2xl text-lg leading-8 text-[var(--ink-muted)]">{messages.lead}</p>
        </header>

        {!featured ? (
          <p className="flex items-center gap-3 rounded-2xl border border-dashed border-[var(--line-strong)] px-5 py-8 text-[var(--ink-muted)]">
            <Newspaper className="size-6 shrink-0 text-[var(--brand)]" aria-hidden="true" />
            {messages.empty}
          </p>
        ) : (
          <div className="space-y-8 pb-6 sm:space-y-10">
            <FeaturedPostCard entry={featured} locale={locale} readArticle={messages.readArticle} />
            {rest.length > 0 && (
              <ul className="grid gap-6 sm:grid-cols-2">
                {rest.map((entry) => (
                  <li key={entry.post.id}>
                    <PostCard entry={entry} locale={locale} readArticle={messages.readArticle} />
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </BlogShell>
  );
}
