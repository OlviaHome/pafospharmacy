import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { unstable_cache } from "next/cache";

import { isLocale } from "@/lib/i18n/config";

import { DEV_BLOG_POSTS, DEV_PREVIEW_POST, DEV_PREVIEW_TOKEN } from "./fixtures";
import type {
  BlogFaqItem,
  BlogImage,
  BlogPost,
  BlogSource,
  BlogTranslation,
} from "./types";

/** Revalidate this tag (revalidateTag(BLOG_CACHE_TAG, "max")) after publishing or editing. */
export const BLOG_CACHE_TAG = "blog";
const BLOG_REVALIDATE_SECONDS = 3_600;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface TranslationRow {
  locale: string;
  status: BlogTranslation["status"];
  title: string;
  description: string;
  body_md: string;
  faq: unknown;
  sources: unknown;
  published_at: string | null;
  updated_at: string;
}

interface ImageRow {
  slot: string;
  url: string | null;
  width: number | null;
  height: number | null;
  alt: unknown;
  placeholder_note: string | null;
  source: BlogImage["source"];
  credit_name: string | null;
  credit_url: string | null;
  source_page_url: string | null;
  license_name?: string | null;
  license_url?: string | null;
}

interface PostRow {
  id: string;
  slug: string;
  status: BlogPost["status"];
  author_name: string;
  published_at: string | null;
  updated_at: string;
  view_count?: number | string | null;
  translations: TranslationRow[] | null;
  images: ImageRow[] | null;
}

const POST_SELECT = `
  id, slug, status, author_name, published_at, updated_at, view_count,
  translations:blog_post_translations(locale, status, title, description, body_md, faq, sources, published_at, updated_at),
  images:blog_images(slot, url, width, height, alt, placeholder_note, source, credit_name, credit_url, source_page_url, license_name, license_url)
`;

function asFaq(value: unknown): BlogFaqItem[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) =>
    item && typeof item.question === "string" && typeof item.answer === "string"
      ? [{ question: item.question, answer: item.answer }]
      : [],
  );
}

function asSources(value: unknown): BlogSource[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) =>
    item && typeof item.title === "string" && typeof item.url === "string" && /^https?:\/\//.test(item.url)
      ? [{ title: item.title, url: item.url }]
      : [],
  );
}

function asAlt(value: unknown): BlogImage["alt"] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter(([key, text]) => isLocale(key) && typeof text === "string"),
  );
}

export function mapPostRow(row: PostRow): BlogPost {
  return {
    id: row.id,
    slug: row.slug,
    status: row.status,
    authorName: row.author_name,
    publishedAt: row.published_at,
    updatedAt: row.updated_at,
    viewCount: Number(row.view_count ?? 0),
    translations: (row.translations ?? []).flatMap((t) =>
      isLocale(t.locale)
        ? [
            {
              locale: t.locale,
              status: t.status,
              title: t.title,
              description: t.description,
              bodyMd: t.body_md,
              faq: asFaq(t.faq),
              sources: asSources(t.sources),
              publishedAt: t.published_at,
              updatedAt: t.updated_at,
            },
          ]
        : [],
    ),
    images: (row.images ?? []).map((image) => ({
      slot: image.slot,
      url: image.url,
      width: image.width,
      height: image.height,
      alt: asAlt(image.alt),
      placeholderNote: image.placeholder_note,
      source: image.source,
      creditName: image.credit_name,
      creditUrl: image.credit_url,
      sourcePageUrl: image.source_page_url,
      licenseName: image.license_name ?? null,
      licenseUrl: image.license_url ?? null,
    })),
  };
}

/** Returns a Supabase client, or null when local development should use demo fixtures. */
function blogClient(): SupabaseClient | null {
  const url = process.env.SUPABASE_URL?.trim();
  const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY?.trim();
  if (url && publishableKey) {
    return createClient(url, publishableKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  if (process.env.NODE_ENV === "production" || url || publishableKey) {
    throw new Error(
      "Supabase runtime configuration is required for the blog. Set SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY.",
    );
  }
  return null;
}

async function fetchPublishedPosts(): Promise<BlogPost[]> {
  const client = blogClient();
  if (!client) return DEV_BLOG_POSTS;
  const { data, error } = await client
    .from("blog_posts")
    .select(POST_SELECT)
    .eq("status", "published")
    .order("published_at", { ascending: false });
  if (error) throw new Error(`Could not load blog posts: ${error.message}`);
  return ((data ?? []) as unknown as PostRow[])
    .map(mapPostRow)
    .filter((post) => post.translations.length > 0);
}

export const getPublishedPosts = unstable_cache(fetchPublishedPosts, ["blog-published-posts"], {
  tags: [BLOG_CACHE_TAG],
  revalidate: BLOG_REVALIDATE_SECONDS,
});

export async function getPublishedPost(slug: string): Promise<BlogPost | null> {
  const posts = await getPublishedPosts();
  return posts.find((post) => post.slug === slug) ?? null;
}

/** Loads any non-archived article by its secret preview token, in every status. Never cached. */
export async function getPreviewPost(token: string): Promise<BlogPost | null> {
  if (!UUID_PATTERN.test(token)) return null;
  const client = blogClient();
  if (!client) return token === DEV_PREVIEW_TOKEN ? DEV_PREVIEW_POST : null;
  const { data, error } = await client.rpc("get_blog_preview", { token });
  if (error) throw new Error(`Could not load blog preview: ${error.message}`);
  if (!data) return null;
  return mapPostRow(data as unknown as PostRow);
}
