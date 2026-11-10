import { ArrowLeft, Info } from "lucide-react";
import Link from "next/link";

import { ArticleLanguageBadges } from "@/components/blog/article-language-badges";
import { BlogFigure } from "@/components/blog/blog-figure";
import { BlogMarkdown } from "@/components/blog/blog-markdown";
import {
  fillTemplate,
  findImage,
  readingMinutes,
  splitBody,
  type ChosenTranslation,
} from "@/lib/blog/content";
import { formatBlogDate, isSameCyprusDay } from "@/lib/blog/format";
import type { BlogPost } from "@/lib/blog/types";
import { LOCALE_NAMES, localeDirection, localePath, SUPPORTED_LOCALES } from "@/lib/i18n/config";
import type { TranslationDictionary } from "@/lib/i18n/types";

export function BlogArticle({
  post,
  chosen,
  siteDictionary,
  contentDictionary,
  basePath,
  preview,
}: {
  post: BlogPost;
  chosen: ChosenTranslation;
  /** Chrome around the article stays in the site language. */
  siteDictionary: TranslationDictionary;
  /** Labels inside the article follow the article language. */
  contentDictionary: TranslationDictionary;
  basePath: string;
  preview: boolean;
}) {
  const { translation } = chosen;
  const siteLocale = siteDictionary.locale;
  const siteMessages = siteDictionary.blog;
  const messages = contentDictionary.blog;
  const contentLocale = translation.locale;
  const cover = findImage(post, "cover");
  const publishedAt = translation.publishedAt ?? post.publishedAt;
  const showUpdated = publishedAt && !isSameCyprusDay(publishedAt, translation.updatedAt);
  const orderedTranslations = SUPPORTED_LOCALES.flatMap((locale) =>
    post.translations.filter((t) => t.locale === locale),
  );

  return (
    <div className="mx-auto w-full max-w-3xl px-4 pt-6 sm:px-6 sm:pt-10">
      <Link
        href={localePath(siteLocale, "/blog")}
        className="inline-flex min-h-11 items-center gap-1.5 text-sm font-bold text-[var(--brand-strong)] underline decoration-[var(--line-strong)] underline-offset-4"
      >
        <ArrowLeft className="size-4 rtl:rotate-180" aria-hidden="true" />
        {siteMessages.backToBlog}
      </Link>

      {preview && (
        <p className="mt-4 rounded-xl border border-[var(--amber)] bg-[var(--amber-soft)] px-4 py-3 text-sm font-semibold text-[var(--amber)]">
          {siteMessages.previewBanner}
        </p>
      )}

      {chosen.isFallback && (
        <p className="mt-4 flex gap-2 rounded-xl bg-[var(--surface-muted)] px-4 py-3 text-sm text-[var(--ink)]">
          <Info className="mt-0.5 size-4 shrink-0 text-[var(--brand)]" aria-hidden="true" />
          {fillTemplate(siteMessages.fallbackNotice, { language: LOCALE_NAMES[contentLocale] })}
        </p>
      )}

      <div className="mt-5">
        <ArticleLanguageBadges
          basePath={basePath}
          siteLocale={siteLocale}
          currentLocale={contentLocale}
          translations={orderedTranslations}
          messages={siteMessages}
          showStatus={preview}
        />
      </div>

      <article lang={contentLocale} dir={localeDirection(contentLocale)} className="mt-6">
        <header>
          <h1 className="text-balance text-[clamp(1.9rem,4.5vw,2.75rem)] font-extrabold leading-[1.08] tracking-[-0.035em] text-[var(--ink)]">
            {translation.title}
          </h1>
          {translation.description && (
            <p className="mt-4 text-lg leading-8 text-[var(--ink-muted)]">{translation.description}</p>
          )}
          <p className="mt-4 flex flex-wrap gap-x-2 gap-y-1 text-sm text-[var(--ink-muted)]">
            <span className="font-semibold text-[var(--ink)]">{post.authorName}</span>
            {publishedAt && (
              <>
                <span aria-hidden="true">·</span>
                <time dateTime={publishedAt}>
                  {fillTemplate(messages.publishedOn, { date: formatBlogDate(publishedAt, contentLocale) })}
                </time>
              </>
            )}
            {showUpdated && (
              <>
                <span aria-hidden="true">·</span>
                <time dateTime={translation.updatedAt}>
                  {fillTemplate(messages.updatedOn, { date: formatBlogDate(translation.updatedAt, contentLocale) })}
                </time>
              </>
            )}
            <span aria-hidden="true">·</span>
            <span>{fillTemplate(messages.minutesRead, { count: readingMinutes(translation) })}</span>
          </p>
        </header>

        {cover && (
          <div className="mt-7">
            <BlogFigure image={cover} locale={contentLocale} messages={messages} showPlaceholder={preview} preload />
          </div>
        )}

        <div className="blog-prose mt-8">
          {splitBody(translation.bodyMd).map((segment, index) => {
            if (segment.type === "markdown") return <BlogMarkdown key={index} text={segment.text} />;
            const image = findImage(post, segment.slot);
            if (!image) return null;
            return (
              <div key={index} className="!my-8">
                <BlogFigure image={image} locale={contentLocale} messages={messages} showPlaceholder={preview} />
              </div>
            );
          })}
        </div>

        {translation.faq.length > 0 && (
          <section className="mt-12" aria-labelledby="blog-faq">
            <h2 id="blog-faq" className="text-2xl font-extrabold tracking-[-0.02em]">
              {messages.faqHeading}
            </h2>
            <div className="mt-4 divide-y divide-[var(--line)] rounded-2xl border border-[var(--line)]">
              {translation.faq.map((item, index) => (
                <details key={index} className="group px-5 py-1" open={index === 0}>
                  <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-4 py-3 text-base font-semibold [&::-webkit-details-marker]:hidden">
                    {item.question}
                    <span
                      aria-hidden="true"
                      className="grid size-7 shrink-0 place-items-center rounded-full bg-[var(--surface-muted)] text-[var(--brand)] transition-transform group-open:rotate-45"
                    >
                      +
                    </span>
                  </summary>
                  <p className="pb-4 text-base leading-7 text-[var(--ink-muted)]">{item.answer}</p>
                </details>
              ))}
            </div>
          </section>
        )}

        {translation.sources.length > 0 && (
          <section className="mt-12" aria-labelledby="blog-sources">
            <h2 id="blog-sources" className="text-2xl font-extrabold tracking-[-0.02em]">
              {messages.sourcesHeading}
            </h2>
            <ol className="mt-4 list-decimal space-y-2 ps-5 text-base leading-7 marker:text-[var(--ink-muted)]">
              {translation.sources.map((source) => (
                <li key={source.url}>
                  <a
                    href={source.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-bold text-[var(--brand-strong)] underline decoration-[var(--line-strong)] underline-offset-4"
                  >
                    {source.title}
                  </a>
                  <span className="block break-all text-xs text-[var(--ink-muted)]" dir="ltr">
                    {source.url.replace(/^https?:\/\//, "")}
                  </span>
                </li>
              ))}
            </ol>
          </section>
        )}

        <aside className="mt-12 rounded-2xl bg-[var(--stone-soft)] px-5 py-4 text-sm leading-6 text-[var(--ink)]">
          <p className="font-extrabold">{messages.disclaimerTitle}</p>
          <p className="mt-1">{messages.disclaimer}</p>
        </aside>
      </article>
    </div>
  );
}
