import { ArrowRight, Newspaper } from "lucide-react";
import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";

import { isHotlinked } from "@/components/blog/blog-figure";
import { BlogShell } from "@/components/blog/blog-shell";
import { chooseTranslation, findImage, imageAlt, pluralize, readingMinutes, translationLocales } from "@/lib/blog/content";
import { formatBlogDate } from "@/lib/blog/format";
import { getPublishedPosts } from "@/lib/blog/repository";
import { isLocale, localeDirection, localePath, LOCALE_NAMES, LOCALE_SHORT_NAMES } from "@/lib/i18n/config";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { localizedAlternates, metadataBase } from "@/lib/i18n/metadata";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  const dictionary = getDictionary(locale);
  return {
    metadataBase,
    title: `${dictionary.blog.title} | ${dictionary.siteTitle}`,
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

  return (
    <BlogShell dictionary={dictionary}>
      <section className="border-b border-[var(--line)] bg-[var(--surface-muted)]">
        <div className="mx-auto w-full max-w-5xl px-4 py-10 sm:px-6 sm:py-14">
          <h1 className="text-[clamp(2.25rem,5vw,3.25rem)] font-extrabold leading-none tracking-[-0.04em] text-[var(--ink)]">
            {messages.title}
          </h1>
          <p className="mt-4 max-w-2xl text-lg leading-8 text-[var(--ink-muted)]">{messages.introduction}</p>
        </div>
      </section>

      <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6 sm:py-10">
        {posts.length === 0 ? (
          <p className="flex items-center gap-3 rounded-2xl border border-dashed border-[var(--line-strong)] px-5 py-8 text-[var(--ink-muted)]">
            <Newspaper className="size-6 shrink-0 text-[var(--brand)]" aria-hidden="true" />
            {messages.empty}
          </p>
        ) : (
          <ul className="grid gap-6 sm:grid-cols-2">
            {posts.map((post) => {
              const chosen = chooseTranslation(post, locale);
              if (!chosen) return null;
              const { translation } = chosen;
              const cover = findImage(post, "cover");
              const publishedAt = translation.publishedAt ?? post.publishedAt;
              const availableLocales = translationLocales(post);
              return (
                <li key={post.id}>
                  <Link
                    href={localePath(locale, `/blog/${post.slug}`)}
                    className="group flex h-full flex-col overflow-hidden rounded-2xl border border-[var(--line)] bg-white transition-shadow hover:shadow-[var(--shadow)]"
                  >
                    <div className="relative aspect-[16/9] w-full overflow-hidden bg-[linear-gradient(135deg,var(--brand),var(--brand-strong))]">
                      {cover?.url ? (
                        <Image
                          src={cover.url}
                          alt={imageAlt(cover, translation.locale)}
                          fill
                          unoptimized={isHotlinked(cover)}
                          sizes="(max-width: 640px) 100vw, 480px"
                          className="object-cover transition-transform duration-500 group-hover:scale-[1.03]"
                        />
                      ) : (
                        <Newspaper className="absolute inset-0 m-auto size-12 text-white/40" aria-hidden="true" />
                      )}
                    </div>
                    <div
                      className="flex flex-1 flex-col p-5"
                      lang={translation.locale}
                      dir={localeDirection(translation.locale)}
                    >
                      <h2 className="text-xl font-extrabold leading-snug tracking-[-0.02em] text-[var(--ink)] group-hover:text-[var(--brand)]">
                        {translation.title}
                      </h2>
                      {translation.description && (
                        <p className="mt-2 line-clamp-3 text-sm leading-6 text-[var(--ink-muted)]">
                          {translation.description}
                        </p>
                      )}
                      <p className="mt-auto flex flex-wrap items-center gap-x-2 gap-y-1 pt-4 text-xs text-[var(--ink-muted)]">
                        {publishedAt && <time dateTime={publishedAt}>{formatBlogDate(publishedAt, translation.locale)}</time>}
                        <span aria-hidden="true">·</span>
                        <span>
                          {pluralize(getDictionary(translation.locale).blog.minutesRead, readingMinutes(translation), translation.locale)}
                        </span>
                        {availableLocales.length > 1 && (
                          <span className="flex flex-wrap gap-1" dir="ltr">
                            {availableLocales.map((l) => (
                              <span
                                key={l}
                                title={LOCALE_NAMES[l]}
                                lang={l}
                                className="rounded-full bg-[var(--surface-muted)] px-2 py-0.5 text-[0.68rem] font-bold text-[var(--brand-strong)]"
                              >
                                {LOCALE_SHORT_NAMES[l]}
                              </span>
                            ))}
                          </span>
                        )}
                      </p>
                    </div>
                    <span className="flex items-center gap-1.5 border-t border-[var(--line)] px-5 py-3 text-sm font-bold text-[var(--brand-strong)]">
                      {messages.readArticle}
                      <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5 rtl:rotate-180" aria-hidden="true" />
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </BlogShell>
  );
}
