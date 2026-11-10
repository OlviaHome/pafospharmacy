import type { Locale } from "@/lib/i18n/types";

export type BlogPostStatus =
  | "generating"
  | "review"
  | "paused"
  | "published"
  | "archived"
  | "failed";

export type BlogTranslationStatus = "draft" | "review" | "published";

export interface BlogFaqItem {
  question: string;
  answer: string;
}

export interface BlogSource {
  title: string;
  url: string;
}

export interface BlogTranslation {
  locale: Locale;
  status: BlogTranslationStatus;
  title: string;
  description: string;
  bodyMd: string;
  faq: BlogFaqItem[];
  sources: BlogSource[];
  publishedAt: string | null;
  updatedAt: string;
}

export interface BlogImage {
  /** "cover" or an inline slot referenced from the body as [[image:<slot>]]. */
  slot: string;
  /** Null for a placeholder the editor still has to fill. */
  url: string | null;
  width: number | null;
  height: number | null;
  alt: Partial<Record<Locale, string>>;
  placeholderNote: string | null;
  source: "pexels" | "unsplash" | "openverse" | "upload" | "placeholder";
  creditName: string | null;
  creditUrl: string | null;
  sourcePageUrl: string | null;
  licenseName: string | null;
  licenseUrl: string | null;
}

export interface BlogPost {
  id: string;
  slug: string;
  status: BlogPostStatus;
  authorName: string;
  publishedAt: string | null;
  updatedAt: string;
  viewCount: number;
  translations: BlogTranslation[];
  images: BlogImage[];
}

export type BlogBodySegment =
  | { type: "markdown"; text: string }
  | { type: "image"; slot: string };
