import { findImage } from "@/lib/blog/content";
import type { BlogPost, BlogTranslation } from "@/lib/blog/types";
import { localePath } from "@/lib/i18n/config";
import { metadataBase } from "@/lib/i18n/metadata";

function absolute(path: string): string {
  return new URL(path, metadataBase).toString();
}

/** Article + FAQPage structured data for search engines and AI answers. */
export function BlogJsonLd({ post, translation }: { post: BlogPost; translation: BlogTranslation }) {
  const url = absolute(localePath(translation.locale, `/blog/${post.slug}`));
  const cover = findImage(post, "cover");
  const graph: Record<string, unknown>[] = [
    {
      "@type": "Article",
      headline: translation.title,
      description: translation.description,
      inLanguage: translation.locale,
      datePublished: translation.publishedAt ?? post.publishedAt ?? undefined,
      dateModified: translation.updatedAt,
      mainEntityOfPage: url,
      url,
      image: cover?.url ? [cover.url] : undefined,
      author: { "@type": "Organization", name: post.authorName, url: absolute("/") },
      publisher: { "@type": "Organization", name: post.authorName, url: absolute("/") },
      citation: translation.sources.map((source) => source.url),
    },
  ];
  if (translation.faq.length > 0) {
    graph.push({
      "@type": "FAQPage",
      inLanguage: translation.locale,
      mainEntity: translation.faq.map((item) => ({
        "@type": "Question",
        name: item.question,
        acceptedAnswer: { "@type": "Answer", text: item.answer },
      })),
    });
  }
  const json = JSON.stringify({ "@context": "https://schema.org", "@graph": graph }).replace(
    /</g,
    "\\u003c",
  );
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: json }} />;
}
