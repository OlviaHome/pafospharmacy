import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";

import type { BlogFaqItem, BlogPostStatus, BlogSource, BlogTranslationStatus } from "@/lib/blog/types";
import { isLocale } from "@/lib/i18n/config";
import type { Locale } from "@/lib/i18n/types";

import type { SourceCheck } from "./checks";
import { asFactEntries, type FactEntry } from "./facts";
import { IMPORT_TTL_MS, MAX_IMPORT_CHARS, type ImportInfo, type PartKind, type PreparedMaterial, type StoredPart } from "./imports";
import type { Suggestion } from "./prepare";
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
  sourceChecks: SourceCheck[];
  /** Fact entries; [] for drafts created before fact checking. */
  factChecks: FactEntry[];
  viewCount: number;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
  translations: TranslationRecord[];
  images: ImageRecord[];
  /** The /import material the draft was written from; null for ordinary drafts. */
  importInfo: ImportInfo | null;
  /** Mode B: proposed changes to the author's text. */
  suggestions: Suggestion[];
}

const POST_COLUMNS = `
  id, number, slug, topic, status, preview_token, last_error, editor_notes, source_checks, fact_checks, view_count,
  published_at, created_at, updated_at,
  translations:blog_post_translations(locale, status, title, description, body_md, faq, sources, published_at, updated_at),
  images:blog_images(id, slot, url, width, height, alt, placeholder_note, source, credit_name, credit_url, source_page_url,
    license_name, license_url, provider_photo_id, tried_photo_ids, search_query, storage_path),
  suggestions,
  import:blog_imports(id, mode, language, source_url, source_label, source_text, source_text_ru, prepared, accepted_hash)
`;

/* eslint-disable @typescript-eslint/no-explicit-any */
function mapImport(raw: any): ImportInfo | null {
  const row = Array.isArray(raw) ? raw[0] : raw;
  if (!row) return null;
  return {
    id: row.id,
    mode: row.mode === "rewrite" || row.mode === "prepare" ? row.mode : null,
    language: row.language ?? null,
    sourceUrl: row.source_url ?? null,
    sourceLabel: row.source_label ?? null,
    sourceText: row.source_text ?? null,
    sourceTextRu: row.source_text_ru ?? null,
    prepared: asPrepared(row.prepared),
    acceptedHash: row.accepted_hash ?? null,
  };
}

function asPrepared(raw: any): PreparedMaterial | null {
  if (!raw || !Array.isArray(raw.pairs)) return null;
  const pairs = raw.pairs.filter((pair: any) => pair && typeof pair.o === "string" && typeof pair.t === "string");
  return { pairs, text: typeof raw.text === "string" ? raw.text : pairs.map((pair: any) => pair.t).join("\n\n") };
}

function asSuggestions(raw: any): Suggestion[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((item: any) => item && typeof item.id === "string" && typeof item.before === "string" && typeof item.after === "string")
    .map((item: any) => ({
      id: item.id,
      before: item.before,
      after: item.after,
      reason: typeof item.reason === "string" ? item.reason : "",
      status: item.status === "accepted" || item.status === "rejected" ? item.status : "pending",
    }));
}

function mapPost(row: any): EditorialPost {
  return {
    importInfo: mapImport(row.import),
    suggestions: asSuggestions(row.suggestions),
    id: row.id,
    number: Number(row.number),
    slug: row.slug,
    topic: row.topic,
    status: row.status,
    previewToken: row.preview_token,
    lastError: row.last_error,
    editorNotes: row.editor_notes,
    sourceChecks: Array.isArray(row.source_checks) ? row.source_checks : [],
    factChecks: asFactEntries(row.fact_checks),
    viewCount: Number(row.view_count ?? 0),
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
    source_checks: SourceCheck[];
    fact_checks: FactEntry[];
    suggestions: Suggestion[];
    published_at: string | null;
  }>,
): Promise<void> {
  check(
    await adminClient().from("blog_posts").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", id),
    "update post",
  );
}

/**
 * Changes a post only while its status is still one of `from`, in one UPDATE, so of two
 * simultaneous requests (a double tap, a redelivered update) exactly one wins.
 * Returns false when another request changed the status first.
 */
export async function transitionPost(
  id: string,
  from: BlogPostStatus[],
  patch: { status: BlogPostStatus; last_error?: string | null; published_at?: string | null },
): Promise<boolean> {
  const data = check(
    await adminClient()
      .from("blog_posts")
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq("id", id)
      .in("status", from)
      .select("id"),
    "transition post",
  );
  return (data ?? []).length === 1;
}

export async function deletePost(id: string): Promise<void> {
  check(await adminClient().from("blog_posts").delete().eq("id", id), "delete post");
}

/** Returns a slug not used by any other post (base, base-2, base-3, …). */
export interface SlugChoice {
  slug: string;
  /** The article that already uses the preferred slug, if any: a likely duplicate. */
  takenBy: { number: number; title: string } | null;
}

/** Returns a slug not used by any other post (base, base-2, …) and who holds the preferred one. */
export async function uniqueSlug(base: string, postId: string): Promise<SlugChoice> {
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
    await adminClient()
      .from("blog_posts")
      .select("id, slug, number, topic, translations:blog_post_translations(locale, title)")
      .like("slug", `${safe}%`)
      .neq("id", postId),
    "check slug",
  );
  const rows = (data ?? []) as { slug: string; number: number; topic: string; translations: { locale: string; title: string }[] }[];
  const taken = new Set(rows.map((row) => row.slug));
  const holder = rows.find((row) => row.slug === safe);
  const takenBy = holder
    ? { number: Number(holder.number), title: holder.translations.find((t) => t.locale === "ru")?.title ?? holder.topic }
    : null;
  if (!taken.has(safe)) return { slug: safe, takenBy };
  for (let n = 2; n < 100; n += 1) if (!taken.has(`${safe}-${n}`)) return { slug: `${safe}-${n}`, takenBy };
  return { slug: `${safe}-${randomUUID().slice(0, 6)}`, takenBy };
}

/** Lightweight list of every non-deleted article, for duplicate detection. */
export async function listTopics(): Promise<{ number: number; status: BlogPostStatus; topic: string; titles: string[] }[]> {
  const data = check(
    await adminClient()
      .from("blog_posts")
      .select("number, status, topic, translations:blog_post_translations(title)")
      .order("number", { ascending: false })
      .limit(500),
    "list topics",
  );
  return ((data ?? []) as { number: number; status: BlogPostStatus; topic: string; translations: { title: string }[] }[]).map(
    (row) => ({
      number: Number(row.number),
      status: row.status,
      topic: row.topic,
      titles: row.translations.map((t) => t.title),
    }),
  );
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

/** Whether a job of this kind is queued or running for the post. */
export async function hasActiveJob(postId: string, kind: JobKind): Promise<boolean> {
  const { count, error } = await adminClient()
    .from("blog_agent_jobs")
    .select("id", { count: "exact", head: true })
    .eq("post_id", postId)
    .eq("kind", kind)
    .in("status", ["queued", "running"]);
  if (error) throw new Error(`active jobs: ${error.message}`);
  return (count ?? 0) > 0;
}

/** The oldest queued or running job of this kind for the post, or null. */
export async function firstActiveJobId(postId: string, kind: JobKind): Promise<number | null> {
  const data = check(
    await adminClient()
      .from("blog_agent_jobs")
      .select("id")
      .eq("post_id", postId)
      .eq("kind", kind)
      .in("status", ["queued", "running"])
      .order("id", { ascending: true })
      .limit(1),
    "first active job",
  );
  return data && data.length > 0 ? Number(data[0].id) : null;
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
      .in("kind", ["write", "rewrite", "prepare"])
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

export type MessagePurpose = "card" | "edit_prompt" | "image_prompt" | "topic_confirm" | "images" | "import";

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

export type TakeTopicResult = { status: "taken"; topic: string } | { status: "busy" } | { status: "missing" };

/**
 * Takes the topic of a "Написать статью?" message exactly once: the payload is cleared only if it
 * still holds the topic that was read, so of two simultaneous taps only one gets it. "busy" means
 * another tap already took it; "missing" means there is no such confirmation message.
 */
export async function takeTopic(chatId: number, messageId: number): Promise<TakeTopicResult> {
  const found = await findMessage(chatId, messageId);
  if (!found || found.purpose !== "topic_confirm" || found.payload === null) return { status: "missing" };
  if (found.payload === "") return { status: "busy" };
  const data = check(
    await adminClient()
      .from("blog_bot_messages")
      .update({ payload: "" })
      .eq("chat_id", chatId)
      .eq("message_id", messageId)
      .eq("payload", found.payload)
      .select("message_id"),
    "take topic",
  );
  return (data ?? []).length === 1 ? { status: "taken", topic: found.payload } : { status: "busy" };
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

/* ---------- /import ---------- */

export interface ImportRecord {
  id: string;
  chatId: number;
  status: "collecting" | "ready" | "started" | "cancelled";
  postId: string | null;
  sourceText: string | null;
  language: string | null;
  sourceUrl: string | null;
  sourceLabel: string | null;
  sourceTextRu: string | null;
  createdAt: string;
  lastPartAt: string | null;
  parts: number;
  chars: number;
}

const IMPORT_COLUMNS = "id, chat_id, status, post_id, source_text, language, source_url, source_label, source_text_ru, created_at, last_part_at, parts:blog_import_parts(message_id, body)";

/* eslint-disable @typescript-eslint/no-explicit-any */
function mapImportRecord(row: any): ImportRecord {
  const parts: { body: string }[] = row.parts ?? [];
  return {
    id: row.id,
    chatId: Number(row.chat_id),
    status: row.status,
    postId: row.post_id,
    sourceText: row.source_text,
    language: row.language,
    sourceUrl: row.source_url,
    sourceLabel: row.source_label,
    sourceTextRu: row.source_text_ru,
    createdAt: row.created_at,
    lastPartAt: row.last_part_at,
    parts: parts.length,
    chars: parts.reduce((sum, part) => sum + part.body.length, 0),
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export async function loadImport(id: string): Promise<ImportRecord | null> {
  const data = check(await adminClient().from("blog_imports").select(IMPORT_COLUMNS).eq("id", id).maybeSingle(), "load import");
  return data ? mapImportRecord(data) : null;
}

/** Drops this chat's unfinished imports older than a day (their parts go with them). */
export async function expireImports(chatId: number, now = new Date()): Promise<void> {
  const cutoff = new Date(now.getTime() - IMPORT_TTL_MS).toISOString();
  check(
    await adminClient()
      .from("blog_imports")
      .delete()
      .eq("chat_id", chatId)
      .in("status", ["collecting", "ready", "cancelled"])
      .lt("updated_at", cutoff),
    "expire imports",
  );
}

/** The chat's unfinished import, if any: at most one is open at a time. */
export async function openImport(chatId: number, now = new Date()): Promise<ImportRecord | null> {
  const cutoff = new Date(now.getTime() - IMPORT_TTL_MS).toISOString();
  const data = check(
    await adminClient()
      .from("blog_imports")
      .select(IMPORT_COLUMNS)
      .eq("chat_id", chatId)
      .in("status", ["collecting", "ready"])
      .gte("updated_at", cutoff)
      .order("created_at", { ascending: false })
      .limit(1),
    "open import",
  );
  return data && data.length > 0 ? mapImportRecord(data[0]) : null;
}

export async function createImport(chatId: number): Promise<string> {
  const data = check(await adminClient().from("blog_imports").insert({ chat_id: chatId }).select("id").single(), "create import");
  if (!data) throw new Error("create import: no row returned");
  return data.id as string;
}

export type AddPartResult = { ok: true; parts: number; chars: number } | { ok: false; reason: "closed" | "too_long" };

/**
 * Adds one part. A message redelivered by Telegram is stored once; nothing is added once the
 * import is no longer collecting or would grow past MAX_IMPORT_CHARS.
 */
export async function addImportPart(
  importId: string,
  messageId: number,
  part: { kind: PartKind; body: string; sourceUrl?: string | null; sourceLabel?: string | null },
): Promise<AddPartResult> {
  const current = await loadImport(importId);
  if (!current || current.status !== "collecting") return { ok: false, reason: "closed" };
  if (current.chars + part.body.length > MAX_IMPORT_CHARS) return { ok: false, reason: "too_long" };
  const db = adminClient();
  check(
    await db.from("blog_import_parts").upsert(
      {
        import_id: importId,
        message_id: messageId,
        kind: part.kind,
        body: part.body,
        source_url: part.sourceUrl ?? null,
        source_label: part.sourceLabel ?? null,
      },
      { onConflict: "import_id,message_id", ignoreDuplicates: true },
    ),
    "add import part",
  );
  const now = new Date().toISOString();
  check(await db.from("blog_imports").update({ last_part_at: now, updated_at: now }).eq("id", importId), "touch import");
  const after = await loadImport(importId);
  return { ok: true, parts: after?.parts ?? 0, chars: after?.chars ?? 0 };
}

export async function importParts(importId: string): Promise<StoredPart[]> {
  const data = check(
    await adminClient()
      .from("blog_import_parts")
      .select("message_id, kind, body, source_url, source_label")
      .eq("import_id", importId)
      .order("message_id", { ascending: true }),
    "import parts",
  );
  return (data ?? []).map((row: { message_id: number; kind: PartKind; body: string; source_url: string | null; source_label: string | null }) => ({
    messageId: Number(row.message_id),
    kind: row.kind,
    body: row.body,
    sourceUrl: row.source_url,
    sourceLabel: row.source_label,
  }));
}

/**
 * Moves an import from one status to another only if it is still in `from` (one conditional
 * UPDATE, so of two simultaneous taps exactly one wins). Returns false otherwise.
 */
export async function transitionImport(
  id: string,
  from: ImportRecord["status"][],
  patch: Partial<{
    status: ImportRecord["status"];
    mode: "rewrite" | "prepare";
    rights_confirmed_at: string;
    post_id: string;
    source_text: string;
    language: string | null;
    source_url: string | null;
    source_label: string;
  }>,
): Promise<boolean> {
  const data = check(
    await adminClient()
      .from("blog_imports")
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq("id", id)
      .in("status", from)
      .select("id"),
    "transition import",
  );
  return (data ?? []).length === 1;
}

/** Cancels an import that has not been turned into a draft yet; its parts are deleted with it. */
export async function deleteImport(id: string): Promise<boolean> {
  const data = check(
    await adminClient().from("blog_imports").delete().eq("id", id).in("status", ["collecting", "ready", "cancelled"]).select("id"),
    "delete import",
  );
  return (data ?? []).length === 1;
}

export async function setImportTranslation(id: string, textRu: string): Promise<void> {
  check(
    await adminClient().from("blog_imports").update({ source_text_ru: textRu, updated_at: new Date().toISOString() }).eq("id", id),
    "import translation",
  );
}

/** Mode B, material in another language: the paragraph pairs and the translation, stored for the comparison and the checks. */
export async function setImportPrepared(id: string, prepared: PreparedMaterial): Promise<void> {
  check(await adminClient().from("blog_imports").update({ prepared, updated_at: new Date().toISOString() }).eq("id", id), "import prepared");
}

/** The editor confirmed the article's own text as it is now (a fingerprint of its words). */
export async function setImportAcceptedHash(id: string, hash: string | null): Promise<void> {
  check(
    await adminClient().from("blog_imports").update({ accepted_hash: hash, updated_at: new Date().toISOString() }).eq("id", id),
    "import accepted hash",
  );
}
