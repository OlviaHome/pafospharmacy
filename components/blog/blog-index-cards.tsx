import { ArrowRight, Newspaper } from "lucide-react";
import Image from "next/image";
import Link from "next/link";

import { isHotlinked } from "@/components/blog/blog-figure";
import { findImage, imageAlt, pluralize, readingMinutes, translationLocales } from "@/lib/blog/content";
import { formatBlogDate } from "@/lib/blog/format";
import type { BlogPost, BlogTranslation } from "@/lib/blog/types";
import { localeDirection, localePath, LOCALE_NAMES, LOCALE_SHORT_NAMES } from "@/lib/i18n/config";
import { getDictionary } from "@/lib/i18n/dictionaries";
import type { Locale } from "@/lib/i18n/types";

export interface BlogIndexEntry {
  post: BlogPost;
  translation: BlogTranslation;
}

function PostMeta({ post, translation }: BlogIndexEntry) {
  const publishedAt = translation.publishedAt ?? post.publishedAt;
  const availableLocales = translationLocales(post);
  return (
    <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-[var(--ink-muted)]">
      {publishedAt && <time dateTime={publishedAt}>{formatBlogDate(publishedAt, translation.locale)}</time>}
      <span aria-hidden="true">·</span>
      <span>{pluralize(getDictionary(translation.locale).blog.minutesRead, readingMinutes(translation), translation.locale)}</span>
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
  );
}

function Cover({ entry, sizes, eager }: { entry: BlogIndexEntry; sizes: string; eager?: boolean }) {
  const cover = findImage(entry.post, "cover");
  return cover?.url ? (
    <Image
      src={cover.url}
      alt={imageAlt(cover, entry.translation.locale)}
      fill
      unoptimized={isHotlinked(cover)}
      sizes={sizes}
      preload={eager}
      className="object-cover transition-transform duration-500 group-hover:scale-[1.03]"
    />
  ) : (
    <Newspaper className="absolute inset-0 m-auto size-12 text-white/40" aria-hidden="true" />
  );
}

const COVER_BACKGROUND = "bg-[linear-gradient(135deg,var(--brand),var(--brand-strong))]";

/** The newest article: large horizontal card, cover first, whole card is one link. */
export function FeaturedPostCard({
  entry,
  locale,
  readArticle,
}: {
  entry: BlogIndexEntry;
  locale: Locale;
  readArticle: string;
}) {
  const { post, translation } = entry;
  return (
    <Link
      href={localePath(locale, `/blog/${post.slug}`)}
      className="group grid overflow-hidden rounded-3xl border border-[var(--line)] bg-white shadow-[var(--shadow)] md:grid-cols-[48fr_52fr]"
    >
      <div className={`relative aspect-[16/10] w-full overflow-hidden md:aspect-auto md:min-h-[22rem] ${COVER_BACKGROUND}`}>
        <Cover entry={entry} sizes="(max-width: 768px) 100vw, 528px" eager />
      </div>
      <div
        className="flex flex-col justify-center gap-4 p-6 sm:p-8 md:p-10"
        lang={translation.locale}
        dir={localeDirection(translation.locale)}
      >
        <PostMeta {...entry} />
        <h2 className="text-balance text-[clamp(1.5rem,2.6vw,2.125rem)] font-extrabold leading-[1.15] tracking-[-0.03em] text-[var(--ink)] group-hover:text-[var(--brand)]">
          {translation.title}
        </h2>
        {translation.description && (
          <p className="line-clamp-4 text-base leading-7 text-[var(--ink-muted)]">{translation.description}</p>
        )}
        <span className="mt-2 inline-flex items-center gap-1.5 text-sm font-bold text-[var(--brand-strong)]">
          {readArticle}
          <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5 rtl:rotate-180" aria-hidden="true" />
        </span>
      </div>
    </Link>
  );
}

export function PostCard({
  entry,
  locale,
  readArticle,
}: {
  entry: BlogIndexEntry;
  locale: Locale;
  readArticle: string;
}) {
  const { post, translation } = entry;
  return (
    <Link
      href={localePath(locale, `/blog/${post.slug}`)}
      className="group flex h-full flex-col overflow-hidden rounded-2xl border border-[var(--line)] bg-white transition-shadow hover:shadow-[var(--shadow)]"
    >
      <div className={`relative aspect-[16/9] w-full overflow-hidden ${COVER_BACKGROUND}`}>
        <Cover entry={entry} sizes="(max-width: 640px) 100vw, 530px" />
      </div>
      <div className="flex flex-1 flex-col p-5" lang={translation.locale} dir={localeDirection(translation.locale)}>
        <h2 className="text-xl font-extrabold leading-snug tracking-[-0.02em] text-[var(--ink)] group-hover:text-[var(--brand)]">
          {translation.title}
        </h2>
        {translation.description && (
          <p className="mt-2 line-clamp-3 text-sm leading-6 text-[var(--ink-muted)]">{translation.description}</p>
        )}
        <div className="mt-auto pt-4">
          <PostMeta {...entry} />
        </div>
      </div>
      <span className="flex items-center gap-1.5 border-t border-[var(--line)] px-5 py-3 text-sm font-bold text-[var(--brand-strong)]">
        {readArticle}
        <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5 rtl:rotate-180" aria-hidden="true" />
      </span>
    </Link>
  );
}
