import "server-only";

import type { BlogPostStatus } from "@/lib/blog/types";

import { DEFAULT_SLOT_TIMES, parseTimes } from "./schedule";
import { adminClient } from "./store";

/** Supabase access for the editorial calendar (tables from 20261120120000_add_blog_publish_schedule). */

export type ScheduleStatus = "scheduled" | "publishing" | "published" | "failed" | "cancelled" | "missed";
export type ScheduleMode = "queue" | "manual";

export interface ScheduleEntry {
  id: string;
  postId: string;
  postNumber: number;
  title: string;
  at: Date;
  mode: ScheduleMode;
  status: ScheduleStatus;
  approvedHash: string;
  approvedWarnings: string[];
  claimedAt: Date | null;
  error: string | null;
}

export const ACTIVE_STATUSES: ScheduleStatus[] = ["scheduled", "publishing"];

function check<T>(result: { data: T; error: { message: string } | null }, what: string): T {
  if (result.error) throw new Error(`${what}: ${result.error.message}`);
  return result.data;
}

const ENTRY_COLUMNS = `
  id, post_id, scheduled_at, mode, status, approved_hash, approved_warnings, claimed_at, error,
  post:blog_posts(number, topic, translations:blog_post_translations(locale, title))
`;

/* eslint-disable @typescript-eslint/no-explicit-any */
function mapEntry(row: any): ScheduleEntry {
  const post = Array.isArray(row.post) ? row.post[0] : row.post;
  const ru = (post?.translations ?? []).find((t: any) => t.locale === "ru");
  return {
    id: row.id,
    postId: row.post_id,
    postNumber: Number(post?.number ?? 0),
    title: ru?.title ?? post?.topic ?? "",
    at: new Date(row.scheduled_at),
    mode: row.mode,
    status: row.status,
    approvedHash: row.approved_hash,
    approvedWarnings: Array.isArray(row.approved_warnings) ? row.approved_warnings : [],
    claimedAt: row.claimed_at ? new Date(row.claimed_at) : null,
    error: row.error ?? null,
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/* ---------- settings ---------- */

export async function loadSlotTimes(): Promise<string[]> {
  const data = check(
    await adminClient().from("blog_publish_settings").select("slot_times").eq("id", true).maybeSingle(),
    "load publish settings",
  );
  const parsed = parseTimes(((data?.slot_times as string[] | undefined) ?? []).join(","));
  return parsed.ok ? parsed.times : [...DEFAULT_SLOT_TIMES];
}

export async function saveSlotTimes(times: string[]): Promise<void> {
  check(
    await adminClient()
      .from("blog_publish_settings")
      .upsert({ id: true, slot_times: times, updated_at: new Date().toISOString() }, { onConflict: "id" }),
    "save publish settings",
  );
}

/* ---------- queue ---------- */

/** Entries still in the queue (scheduled or being published), earliest first. */
export async function listActiveEntries(): Promise<ScheduleEntry[]> {
  const data = check(
    await adminClient()
      .from("blog_publish_schedule")
      .select(ENTRY_COLUMNS)
      .in("status", ACTIVE_STATUSES)
      .order("scheduled_at", { ascending: true })
      .limit(500),
    "list schedule",
  );
  return (data ?? []).map(mapEntry);
}

export async function activeEntryForPost(postId: string): Promise<ScheduleEntry | null> {
  const data = check(
    await adminClient()
      .from("blog_publish_schedule")
      .select(ENTRY_COLUMNS)
      .eq("post_id", postId)
      .in("status", ACTIVE_STATUSES)
      .limit(1),
    "active schedule entry",
  );
  return data && data.length > 0 ? mapEntry(data[0]) : null;
}

export type ScheduleResult = "ok" | "status" | "past" | "slot_taken" | "post_taken";

/** The post becomes 'scheduled' and gets its entry in one transaction (see schedule_blog_post). */
export async function schedulePost(input: {
  postId: string;
  at: Date;
  mode: ScheduleMode;
  hash: string;
  warnings: string[];
  from: BlogPostStatus[];
}): Promise<ScheduleResult> {
  const data = check(
    await adminClient().rpc("schedule_blog_post", {
      p_post_id: input.postId,
      p_at: input.at.toISOString(),
      p_mode: input.mode,
      p_hash: input.hash,
      p_warnings: input.warnings,
      p_from: input.from,
    }),
    "schedule post",
  );
  return data as ScheduleResult;
}

/**
 * Takes an entry out of the queue with a final status and a reason; with revertPost the article
 * goes back to review in the same transaction. False when the entry was no longer in `from`.
 */
export async function releaseEntry(
  entryId: string,
  from: ScheduleStatus[],
  status: Exclude<ScheduleStatus, "scheduled" | "publishing">,
  options: { error?: string | null; revertPost?: boolean; postError?: string | null } = {},
): Promise<boolean> {
  const data = check(
    await adminClient().rpc("release_blog_schedule", {
      p_entry_id: entryId,
      p_from: from,
      p_status: status,
      p_error: options.error ?? null,
      p_revert_post: options.revertPost ?? false,
      p_post_error: options.postError ?? null,
    }),
    "release schedule entry",
  );
  return data === true;
}

/** Moves scheduled entries to new times at once; 'changed' when one of them left the queue. */
export async function moveEntries(moves: { id: string; to: Date }[]): Promise<"ok" | "changed" | "slot_taken"> {
  const data = check(
    await adminClient().rpc("move_blog_schedule", {
      p_ids: moves.map((move) => move.id),
      p_times: moves.map((move) => move.to.toISOString()),
    }),
    "move schedule entries",
  );
  return data as "ok" | "changed" | "slot_taken";
}

/** A time the editor moved by hand is kept when the queue is redistributed. */
export async function setEntryMode(entryId: string, mode: ScheduleMode): Promise<void> {
  check(
    await adminClient()
      .from("blog_publish_schedule")
      .update({ mode, updated_at: new Date().toISOString() })
      .eq("id", entryId)
      .eq("status", "scheduled"),
    "set schedule mode",
  );
}

/**
 * Claims a due entry for publication: one conditional update, so of two scheduler calls running
 * at once only one gets it.
 */
export async function claimEntry(entryId: string, now: Date): Promise<boolean> {
  const data = check(
    await adminClient()
      .from("blog_publish_schedule")
      .update({ status: "publishing", claimed_at: now.toISOString(), updated_at: now.toISOString() })
      .eq("id", entryId)
      .eq("status", "scheduled")
      .lte("scheduled_at", now.toISOString())
      .select("id"),
    "claim schedule entry",
  );
  return (data ?? []).length === 1;
}

/** Closes the article's active entry after it was published (by the scheduler or by hand). */
export async function markPostPublished(postId: string, note: string | null = null): Promise<void> {
  const now = new Date().toISOString();
  check(
    await adminClient()
      .from("blog_publish_schedule")
      .update({ status: "published", error: note, finished_at: now, updated_at: now })
      .eq("post_id", postId)
      .in("status", ACTIVE_STATUSES),
    "close schedule entry",
  );
}

/* ---------- published history ---------- */

export interface PublishedRow {
  number: number;
  slug: string;
  title: string;
  publishedAt: string | null;
}

/** One page of published articles, newest publication first, with the total count. */
export async function listPublishedPage(page: number, size: number): Promise<{ rows: PublishedRow[]; total: number }> {
  const from = Math.max(0, (page - 1) * size);
  const result = await adminClient()
    .from("blog_posts")
    .select("number, slug, topic, published_at, translations:blog_post_translations(locale, title)", { count: "exact" })
    .eq("status", "published")
    .order("published_at", { ascending: false })
    .order("number", { ascending: false })
    .range(from, from + size - 1);
  if (result.error) throw new Error(`list published: ${result.error.message}`);
  const rows = ((result.data ?? []) as { number: number; slug: string; topic: string; published_at: string | null; translations: { locale: string; title: string }[] }[]).map(
    (row) => ({
      number: Number(row.number),
      slug: row.slug,
      title: row.translations.find((t) => t.locale === "ru")?.title ?? row.topic,
      publishedAt: row.published_at,
    }),
  );
  return { rows, total: result.count ?? rows.length };
}
