import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";

import type { BlogFaqItem, BlogPostStatus, BlogSource, BlogTranslationStatus } from "@/lib/blog/types";
import { isLocale } from "@/lib/i18n/config";
import type { Locale } from "@/lib/i18n/types";

import { supabaseAdminConfig } from "./config";
import { cyprusDayStart, cyprusMonthStart, STALE_JOB_MS, type JobKind, type UsageSnapshot } from "./limits";
import type { UsageNumbers } from "./pricing";

let client: SupabaseClient | null = null;

/** Server-only client with the secret key. Never import this from page code. */
export function adminClient(): SupabaseClient {
  if (!client) {
    const { url, secretKey } = supabaseAdminConfig();
    client = createClient(url, secretKey, { auth: { persistSession: false, autoRefreshToken: false } });
  }
  return client;
}

function check<T>(result: { data: T; error: { message: string } | null }, what: string): T {
  if (result.error) throw new Error(`${what}: ${result.error.message}`);
  return result.data;
}

export interface TranslationRecord {
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

export interface ImageRecord {
  id: string;
  slot: string;
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
  providerPhotoId: string | null;
  triedPhotoIds: string[];
  searchQuery: string | null;
  storagePath: string | null;
}

export interface EditorialPost {
  id: string;
  number: number;
  slug: string;
  topic: string;
  status: BlogPostStatus;
  previewToken: string;
  lastError: string | null;
  editorNotes: string | null;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
  translations: TranslationRecord[];
  images: ImageRecord[];
}

const POST_COLUMNS = `
  id, number, slug, topic, status, preview_token, last_error, editor_notes, published_at, created_at, updated_at,
  translations:blog_post_translations(locale, status, title, description, body_md, faq, sources, published_at, updated_at),
  images:blog_images(id, slot, url, width, height, alt, placeholder_note, source, credit_name, credit_url, source_page_url,
    license_name, license_url, provider_photo_id, tried_photo_ids, search_query, storage_path)
`;

/* eslint-disable @typescript-eslint/no-explicit-any */
function mapPost(row: any): EditorialPost {
  return {
    id: row.id,
    number: Number(row.number),
    slug: row.slug,
    topic: row.topic,
    status: row.status,
    previewToken: row.preview_token,
    lastError: row.last_error,
    editorNotes: row.editor_notes,
    publishedAt: row.published_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    translations: (row.translations ?? [])
      .filter((t: any) => isLocale(t.locale))
      .map((t: any) => ({
        locale: t.locale,
        status: t.status,
        title: t.title,
        description: t.description,
        bodyMd: t.body_md,
        faq: Array.isArray(t.faq) ? t.faq : [],
        sources: Array.isArray(t.sources) ? t.sources : [],
        publishedAt: t.published_at,
        updatedAt: t.updated_at,
      })),
    images: (row.images ?? [])
      .map((i: any) => ({
        id: i.id,
        slot: i.slot,
        url: i.url,
        width: i.width,
        height: i.height,
        alt: i.alt ?? {},
        placeholderNote: i.placeholder_note,
        source: i.source,
        creditName: i.credit_name,
        creditUrl: i.credit_url,
        sourcePageUrl: i.source_page_url,
        licenseName: i.license_name,
        licenseUrl: i.license_url,
        providerPhotoId: i.provider_photo_id,
        triedPhotoIds: i.tried_photo_ids ?? [],
        searchQuery: i.search_query,
        storagePath: i.storage_path,
      }))
      .sort((a: ImageRecord, b: ImageRecord) =>
        a.slot === "cover" ? -1 : b.slot === "cover" ? 1 : a.slot.localeCompare(b.slot, "en", { numeric: true }),
      ),
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export async function loadPost(ref: { id: string } | { number: number }): Promise<EditorialPost | null> {
  let query = adminClient().from("blog_posts").select(POST_COLUMNS);
  query = "id" in ref ? query.eq("id", ref.id) : query.eq("number", ref.number);
  const data = check(await query.maybeSingle(), "load post");
  return data ? mapPost(data) : null;
}

export async function listPosts(statuses: BlogPostStatus[], limit = 20): Promise<EditorialPost[]> {
  const data = check(
    await adminClient()
      .from("blog_posts")
      .select(POST_COLUMNS)
      .in("status", statuses)
      .order("updated_at", { ascending: false })
      .limit(limit),
    "list posts",
  );
  return (data ?? []).map(mapPost);
}

export async function createPost(topic: string): Promise<EditorialPost> {
  const data = check(
    await adminClient()
      .from("blog_posts")
      .insert({ slug: `draft-${randomUUID().slice(0, 8)}`, topic, status: "generating" })
      .select("id")
      .single(),
    "create post",
  );
  if (!data) throw new Error("create post: no row returned");
  return (await loadPost({ id: data.id }))!;
}

export async function updatePost(
  id: string,
  patch: Partial<{
    status: BlogPostStatus;
    slug: string;
    last_error: string | null;
    editor_notes: string | null;
    published_at: string | null;
  }>,
): Promise<void> {
  check(
    await adminClient().from("blog_posts").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", id),
    "update post",
  );
}

export async function deletePost(id: string): Promise<void> {
  check(await adminClient().from("blog_posts").delete().eq("id", id), "delete post");
}

/** Returns a slug not used by any other post (base, base-2, base-3, …). */
export async function uniqueSlug(base: string, postId: string): Promise<string> {
  const clean =
    base
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60)
      .replace(/-+$/g, "") || "article";
  const safe = clean === "preview" ? "preview-article" : clean;
  const data = check(
    await adminClient().from("blog_posts").select("id, slug").like("slug", `${safe}%`).neq("id", postId),
    "check slug",
  );
  const taken = new Set((data ?? []).map((row: { slug: string }) => row.slug));
  if (!taken.has(safe)) return safe;
  for (let n = 2; n < 100; n += 1) if (!taken.has(`${safe}-${n}`)) return `${safe}-${n}`;
  return `${safe}-${randomUUID().slice(0, 6)}`;
}

export interface TranslationFields {
  title: string;
  description: string;
  bodyMd: string;
  faq: BlogFaqItem[];
  sources: BlogSource[];
}

/**
 * Writes one translation, first saving the previous version (if any) into the revision history
 * under batchId, so one editor action can be rolled back across languages.
 */
export async function saveTranslation(
  post: EditorialPost,
  locale: Locale,
  fields: TranslationFields,
  status: BlogTranslationStatus,
  batchId: string,
  note: string,
): Promise<void> {
  const db = adminClient();
  const previous = post.translations.find((t) => t.locale === locale);
  if (previous) {
    check(
      await db.from("blog_post_revisions").insert({
        post_id: post.id,
        locale,
        title: previous.title,
        description: previous.description,
        body_md: previous.bodyMd,
        faq: previous.faq,
        sources: previous.sources,
        note,
        batch_id: batchId,
      }),
      "save revision",
    );
  }
  check(
    await db.from("blog_post_translations").upsert(
      {
        post_id: post.id,
        locale,
        status,
        title: fields.title,
        description: fields.description,
        body_md: fields.bodyMd,
        faq: fields.faq,
        sources: fields.sources,
        published_at: status === "published" ? (previous?.publishedAt ?? new Date().toISOString()) : null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "post_id,locale" },
    ),
    "save translation",
  );
}

export async function setTranslationStatus(
  postId: string,
  locales: Locale[],
  status: BlogTranslationStatus,
): Promise<void> {
  if (locales.length === 0) return;
  const now = new Date().toISOString();
  const db = adminClient();
  if (status === "published") {
    // Keep the first publication date of a language that is re-published.
    check(
      await db
        .from("blog_post_translations")
        .update({ status, published_at: now })
        .eq("post_id", postId)
        .in("locale", locales)
        .is("published_at", null),
      "publish translations",
    );
    check(
      await db.from("blog_post_translations").update({ status }).eq("post_id", postId).in("locale", locales),
      "publish translations",
    );
    return;
  }
  check(
    await db
      .from("blog_post_translations")
      .update({ status, published_at: null })
      .eq("post_id", postId)
      .in("locale", locales),
    "set translation status",
  );
}

/** Restores the most recent revision batch. Returns the locales restored, or [] if none. */
export async function undoLastChange(post: EditorialPost): Promise<Locale[]> {
  const db = adminClient();
  const latest = check(
    await db
      .from("blog_post_revisions")
      .select("batch_id")
      .eq("post_id", post.id)
      .not("batch_id", "is", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    "find revision",
  );
  if (!latest?.batch_id) return [];
  const rows = check(
    await db.from("blog_post_revisions").select("*").eq("post_id", post.id).eq("batch_id", latest.batch_id),
    "load revision",
  );
  const restored: Locale[] = [];
  for (const row of rows ?? []) {
    if (!isLocale(row.locale)) continue;
    check(
      await db
        .from("blog_post_translations")
        .update({
          title: row.title,
          description: row.description,
          body_md: row.body_md,
          faq: row.faq,
          sources: row.sources,
          updated_at: new Date().toISOString(),
        })
        .eq("post_id", post.id)
        .eq("locale", row.locale),
      "restore revision",
    );
    restored.push(row.locale);
  }
  check(
    await db.from("blog_post_revisions").delete().eq("post_id", post.id).eq("batch_id", latest.batch_id),
    "drop revision",
  );
  return restored;
}

export async function hasUndo(postId: string): Promise<boolean> {
  const { count } = await adminClient()
    .from("blog_post_revisions")
    .select("id", { count: "exact", head: true })
    .eq("post_id", postId)
    .not("batch_id", "is", null);
  return (count ?? 0) > 0;
}

export type ImageFields = Partial<{
  url: string | null;
  width: number | null;
  height: number | null;
  alt: Partial<Record<Locale, string>>;
  placeholder_note: string | null;
  source: ImageRecord["source"];
  credit_name: string | null;
  credit_url: string | null;
  source_page_url: string | null;
  license_name: string | null;
  license_url: string | null;
  provider_photo_id: string | null;
  tried_photo_ids: string[];
  search_query: string | null;
  storage_path: string | null;
}>;

export async function upsertImage(postId: string, slot: string, fields: ImageFields): Promise<void> {
  check(
    await adminClient()
      .from("blog_images")
      .upsert({ post_id: postId, slot, ...fields, updated_at: new Date().toISOString() }, { onConflict: "post_id,slot" }),
    "save image",
  );
}

/* ---------- jobs and usage ---------- */

export interface JobRecord {
  id: number;
  postId: string | null;
  kind: JobKind;
  status: "queued" | "running" | "done" | "failed";
  payload: Record<string, unknown>;
}

export async function enqueueJob(postId: string, kind: JobKind, payload: Record<string, unknown>): Promise<number> {
  const data = check(
    await adminClient().from("blog_agent_jobs").insert({ post_id: postId, kind, payload }).select("id").single(),
    "enqueue job",
  );
  if (!data) throw new Error("enqueue job: no row returned");
  return Number(data.id);
}

export async function claimJob(id: number): Promise<JobRecord | null> {
  const data = check(await adminClient().rpc("claim_blog_agent_job", { job_id: id }), "claim job");
  const row = Array.isArray(data) ? data[0] : null;
  if (!row) return null;
  return { id: Number(row.id), postId: row.post_id, kind: row.kind, status: row.status, payload: row.payload ?? {} };
}

export async function finishJob(id: number, status: "done" | "failed", error?: string): Promise<void> {
  check(
    await adminClient()
      .from("blog_agent_jobs")
      .update({ status, error: error?.slice(0, 2000) ?? null, finished_at: new Date().toISOString() })
      .eq("id", id),
    "finish job",
  );
}

/** Marks jobs whose function was killed as failed, so they stop counting as active. */
export async function failStaleJobs(now = new Date()): Promise<void> {
  const cutoff = new Date(now.getTime() - STALE_JOB_MS).toISOString();
  await adminClient()
    .from("blog_agent_jobs")
    .update({ status: "failed", error: "timed out", finished_at: now.toISOString() })
    .in("status", ["running", "queued"])
    .lt("created_at", cutoff);
}

export async function recordUsage(jobId: number | null, model: string, usage: UsageNumbers, costUsd: number) {
  check(
    await adminClient().from("blog_ai_usage").insert({
      job_id: jobId,
      model,
      input_tokens: usage.inputTokens,
      cached_input_tokens: usage.cachedInputTokens,
      output_tokens: usage.outputTokens,
      web_search_calls: usage.webSearchCalls,
      cost_usd: costUsd,
    }),
    "record usage",
  );
}

export async function usageSnapshot(now = new Date()): Promise<UsageSnapshot> {
  const db = adminClient();
  const dayStart = cyprusDayStart(now);
  const [active, today, articles, spend] = await Promise.all([
    db.from("blog_agent_jobs").select("id", { count: "exact", head: true }).in("status", ["queued", "running"]),
    db.from("blog_agent_jobs").select("id", { count: "exact", head: true }).gte("created_at", dayStart),
    db
      .from("blog_agent_jobs")
      .select("id", { count: "exact", head: true })
      .eq("kind", "write")
      .gte("created_at", dayStart),
    db.from("blog_ai_usage").select("cost_usd").gte("created_at", cyprusMonthStart(now)),
  ]);
  for (const result of [active, today, articles, spend]) {
    if (result.error) throw new Error(`usage snapshot: ${result.error.message}`);
  }
  const spent = (spend.data ?? []).reduce((sum, row: { cost_usd: number | string }) => sum + Number(row.cost_usd), 0);
  return {
    activeJobs: active.count ?? 0,
    jobsToday: today.count ?? 0,
    articlesToday: articles.count ?? 0,
    spentThisMonthUsd: spent,
  };
}

export async function postCostUsd(postId: string): Promise<number> {
  const jobs = check(await adminClient().from("blog_agent_jobs").select("id").eq("post_id", postId), "post jobs");
  const ids = (jobs ?? []).map((row: { id: number }) => row.id);
  if (ids.length === 0) return 0;
  const rows = check(await adminClient().from("blog_ai_usage").select("cost_usd").in("job_id", ids), "post usage");
  return (rows ?? []).reduce((sum, row: { cost_usd: number | string }) => sum + Number(row.cost_usd), 0);
}

/* ---------- bot bookkeeping ---------- */

/** Returns true the first time an update id is seen. */
export async function markUpdateProcessed(updateId: number): Promise<boolean> {
  const { error } = await adminClient().from("blog_bot_updates").insert({ update_id: updateId });
  if (!error) return true;
  if (error.code === "23505") return false;
  throw new Error(`mark update: ${error.message}`);
}

export type MessagePurpose = "card" | "edit_prompt" | "image_prompt" | "topic_confirm" | "images";

export async function rememberMessage(
  chatId: number,
  messageId: number,
  purpose: MessagePurpose,
  postId: string | null,
  extra: { slot?: string; payload?: string } = {},
): Promise<void> {
  check(
    await adminClient().from("blog_bot_messages").upsert({
      chat_id: chatId,
      message_id: messageId,
      post_id: postId,
      purpose,
      slot: extra.slot ?? null,
      payload: extra.payload ?? null,
    }),
    "remember message",
  );
}

export async function findMessage(
  chatId: number,
  messageId: number,
): Promise<{ postId: string | null; purpose: MessagePurpose; slot: string | null; payload: string | null } | null> {
  const data = check(
    await adminClient()
      .from("blog_bot_messages")
      .select("post_id, purpose, slot, payload")
      .eq("chat_id", chatId)
      .eq("message_id", messageId)
      .maybeSingle(),
    "find message",
  );
  return data ? { postId: data.post_id, purpose: data.purpose, slot: data.slot, payload: data.payload } : null;
}
