import "server-only";

import { adminClient } from "./store";

/** Database access of the Scout (server only; the tables have no public access). */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function check(result: { data: any; error: { message: string } | null }, label: string): any {
  if (result.error) throw new Error(`${label}: ${result.error.message}`);
  return result.data;
}

/* ---------- sources ---------- */

export type SourceCheckState = "ok" | "blocked" | "unreachable" | "not_feed" | "empty" | "search";

export interface NewsSource {
  id: string;
  number: number;
  name: string;
  kind: "rss" | "search";
  url: string;
  language: string;
  priority: number;
  enabled: boolean;
  approvedAt: string | null;
  checkState: SourceCheckState | null;
  checkDetail: string | null;
  checkedAt: string | null;
}

const SOURCE_COLUMNS = "id, number, name, kind, url, language, priority, enabled, approved_at, check_state, check_detail, checked_at";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapSource(row: any): NewsSource {
  return {
    id: row.id,
    number: row.number,
    name: row.name,
    kind: row.kind,
    url: row.url,
    language: row.language,
    priority: row.priority,
    enabled: row.enabled,
    approvedAt: row.approved_at,
    checkState: row.check_state,
    checkDetail: row.check_detail,
    checkedAt: row.checked_at,
  };
}

export async function listSources(): Promise<NewsSource[]> {
  const rows = check(await adminClient().from("news_sources").select(SOURCE_COLUMNS).order("priority").order("number"), "list sources");
  return (rows ?? []).map(mapSource);
}

/** Approves or switches off a source. Approval stamps the date; switching off keeps it for the record. */
export async function setSourceEnabled(number: number, enabled: boolean): Promise<NewsSource | null> {
  const patch = enabled ? { enabled: true, approved_at: new Date().toISOString() } : { enabled: false };
  const rows = check(
    await adminClient()
      .from("news_sources")
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq("number", number)
      .select(SOURCE_COLUMNS),
    "set source",
  );
  return rows?.[0] ? mapSource(rows[0]) : null;
}

export async function recordSourceCheck(id: string, state: SourceCheckState, detail: string): Promise<void> {
  check(
    await adminClient()
      .from("news_sources")
      .update({ check_state: state, check_detail: detail.slice(0, 200), checked_at: new Date().toISOString() })
      .eq("id", id),
    "record source check",
  );
}

/* ---------- runs ---------- */

/** A "running" run older than this is considered dead (the function was killed). */
export const RUN_STALE_MS = 15 * 60 * 1000;

export type RunKind = "real" | "test";
export type RunClaim = { status: "claimed"; runId: string } | { status: "done" | "running"; runId: string };

export interface NewsRun {
  id: string;
  runDate: string;
  kind: RunKind;
  status: "running" | "done" | "failed";
  errorCode: string | null;
  stats: Record<string, unknown>;
  startedAt: string;
  finishedAt: string | null;
}

/**
 * Takes the run of this date and kind. The unique key (date, kind) makes a repeated or parallel call
 * lose; a failed run, a dead one, and a finished test run can be taken again, a finished real run
 * cannot (the scheduler may call twice, the digest is sent once).
 */
export async function claimRun(date: string, kind: RunKind, trigger: "manual" | "schedule", model: string): Promise<RunClaim> {
  const db = adminClient();
  const inserted = await db.from("news_runs").insert({ run_date: date, kind, trigger, model }).select("id").single();
  if (!inserted.error) return { status: "claimed", runId: inserted.data.id };
  if (inserted.error.code !== "23505") throw new Error(`claim run: ${inserted.error.message}`);

  const existing = check(
    await db.from("news_runs").select("id, status, started_at").eq("run_date", date).eq("kind", kind).single(),
    "read run",
  );
  const stale = Date.now() - Date.parse(existing.started_at) > RUN_STALE_MS;
  const restartable =
    existing.status === "failed" || (existing.status === "running" && stale) || (kind === "test" && existing.status === "done");
  if (!restartable) return { status: existing.status, runId: existing.id };
  const taken = check(
    await db
      .from("news_runs")
      .update({
        status: "running",
        trigger,
        model,
        error_code: null,
        stats: {},
        started_at: new Date().toISOString(),
        finished_at: null,
      })
      .eq("id", existing.id)
      .eq("status", existing.status)
      .eq("started_at", existing.started_at)
      .select("id"),
    "retake run",
  );
  return taken?.length ? { status: "claimed", runId: existing.id } : { status: "running", runId: existing.id };
}

export async function finishRun(id: string, status: "done" | "failed", errorCode: string | null, stats: Record<string, unknown>): Promise<void> {
  check(
    await adminClient()
      .from("news_runs")
      .update({ status, error_code: errorCode, stats, finished_at: new Date().toISOString() })
      .eq("id", id),
    "finish run",
  );
}

/** The state of today's run of this kind, for a quick answer before a job is queued. */
export async function peekRun(date: string, kind: RunKind): Promise<{ id: string; status: "running" | "done" | "failed"; startedAt: string } | null> {
  const row = check(
    await adminClient().from("news_runs").select("id, status, started_at").eq("run_date", date).eq("kind", kind).maybeSingle(),
    "peek run",
  );
  return row ? { id: row.id, status: row.status, startedAt: row.started_at } : null;
}

export async function lastSuccessfulRunStart(): Promise<Date | null> {
  const row = check(
    await adminClient()
      .from("news_runs")
      .select("started_at")
      .eq("kind", "real")
      .eq("status", "done")
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    "last run",
  );
  return row ? new Date(row.started_at) : null;
}

/* ---------- items ---------- */

export interface NewsItem {
  id: string;
  sourceId: string | null;
  url: string;
  title: string;
  summary: string;
  publishedAt: string | null;
}

export interface NewItemInput {
  sourceId: string | null;
  url: string;
  title: string;
  summary: string;
  publishedAt: string | null;
}

/** Stores publications; an address seen before is left as it is (the technical duplicate key). */
export async function insertItems(items: NewItemInput[]): Promise<void> {
  if (items.length === 0) return;
  check(
    await adminClient()
      .from("news_items")
      .upsert(
        items.map((item) => ({
          source_id: item.sourceId,
          url: item.url,
          title: item.title,
          summary: item.summary || null,
          published_at: item.publishedAt,
        })),
        { onConflict: "url", ignoreDuplicates: true },
      ),
    "insert items",
  );
}

/** Publications no selection has looked at yet, newest first. */
export async function pendingItems(since: Date, limit: number): Promise<NewsItem[]> {
  const rows = check(
    await adminClient()
      .from("news_items")
      .select("id, source_id, url, title, summary, published_at")
      .is("processed_at", null)
      .or(`published_at.is.null,published_at.gte.${since.toISOString()}`)
      .order("published_at", { ascending: false, nullsFirst: false })
      .limit(limit),
    "pending items",
  );
  return (rows ?? []).map((row: Record<string, string | null>) => ({
    id: row.id as string,
    sourceId: row.source_id,
    url: row.url as string,
    title: row.title as string,
    summary: row.summary ?? "",
    publishedAt: row.published_at,
  }));
}

/** Old unprocessed publications are closed so they never pile up. */
export async function discardStaleItems(before: Date): Promise<void> {
  check(
    await adminClient()
      .from("news_items")
      .update({ processed_at: new Date().toISOString() })
      .is("processed_at", null)
      .lt("published_at", before.toISOString()),
    "discard stale items",
  );
}

export async function markItemsProcessed(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  check(await adminClient().from("news_items").update({ processed_at: new Date().toISOString() }).in("id", ids), "mark items");
}

export async function attachItems(eventId: string, itemIds: string[]): Promise<void> {
  if (itemIds.length === 0) return;
  check(await adminClient().from("news_items").update({ event_id: eventId }).in("id", itemIds), "attach items");
}

/* ---------- events ---------- */

export type EventStatus = "new" | "shown" | "skipped" | "in_work";

export interface NewsEvent {
  id: string;
  number: number;
  titleRu: string;
  gist: string;
  why: string;
  score: number;
  scoreReason: string;
  status: EventStatus;
  links: { title: string; url: string }[];
  firstSeenAt: string;
  shownAt: string | null;
  postId: string | null;
}

const EVENT_COLUMNS = "id, number, title_ru, gist, why, score, score_reason, status, links, first_seen_at, shown_at, post_id";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapEvent(row: any): NewsEvent {
  return {
    id: row.id,
    number: row.number,
    titleRu: row.title_ru,
    gist: row.gist,
    why: row.why ?? "",
    score: row.score,
    scoreReason: row.score_reason ?? "",
    status: row.status,
    links: Array.isArray(row.links) ? row.links.filter((link: { url?: unknown }) => typeof link?.url === "string") : [],
    firstSeenAt: row.first_seen_at,
    shownAt: row.shown_at,
    postId: row.post_id,
  };
}

/** Events of the last days, with their status: what the model compares new publications with. */
export async function recentEvents(sinceIso: string): Promise<NewsEvent[]> {
  const rows = check(
    await adminClient().from("news_events").select(EVENT_COLUMNS).gte("updated_at", sinceIso).order("updated_at", { ascending: false }).limit(100),
    "recent events",
  );
  return (rows ?? []).map(mapEvent);
}

export interface EventFields {
  title: string;
  gist: string;
  why: string;
  score: number;
  scoreReason: string;
  links: { title: string; url: string }[];
}

export async function createEvent(fields: EventFields): Promise<string> {
  const row = check(
    await adminClient()
      .from("news_events")
      .insert({
        title_ru: fields.title,
        gist: fields.gist,
        why: fields.why || null,
        score: fields.score,
        score_reason: fields.scoreReason || null,
        links: fields.links,
      })
      .select("id")
      .single(),
    "create event",
  );
  return row.id;
}

/** A substantial new development: the event is refreshed and goes back to "new" so the next digest shows it. */
export async function reopenEvent(id: string, fields: EventFields): Promise<void> {
  check(
    await adminClient()
      .from("news_events")
      .update({
        title_ru: fields.title,
        gist: fields.gist,
        why: fields.why || null,
        score: fields.score,
        score_reason: fields.scoreReason || null,
        links: fields.links,
        status: "new",
        skipped_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      // An event that an article was started from is never reopened.
      .neq("status", "in_work"),
    "reopen event",
  );
}

export async function listNewEvents(): Promise<NewsEvent[]> {
  const rows = check(await adminClient().from("news_events").select(EVENT_COLUMNS).eq("status", "new"), "new events");
  return (rows ?? []).map(mapEvent);
}

/**
 * Marks events as shown by one conditional update; returns the ones this call really flipped. Only
 * those get a message, so a repeated call never shows a topic twice.
 */
export async function claimShown(ids: string[], runId: string): Promise<NewsEvent[]> {
  if (ids.length === 0) return [];
  const rows = check(
    await adminClient()
      .from("news_events")
      .update({ status: "shown", shown_at: new Date().toISOString(), shown_run_id: runId, updated_at: new Date().toISOString() })
      .in("id", ids)
      .eq("status", "new")
      .select(EVENT_COLUMNS),
    "claim shown",
  );
  return (rows ?? []).map(mapEvent);
}

export async function loadEvent(number: number): Promise<NewsEvent | null> {
  const row = check(await adminClient().from("news_events").select(EVENT_COLUMNS).eq("number", number).maybeSingle(), "load event");
  return row ? mapEvent(row) : null;
}

/**
 * The editor chose "write an article": the event becomes "in work" and carries the draft. One
 * conditional update, so of two taps only one gets the event back (the other opens the same draft).
 */
export async function claimForWork(number: number, postId: string): Promise<NewsEvent | null> {
  const rows = check(
    await adminClient()
      .from("news_events")
      .update({ status: "in_work", post_id: postId, updated_at: new Date().toISOString() })
      .eq("number", number)
      // A topic whose draft was deleted (post_id back to null) can be taken again.
      .or("status.in.(new,shown,skipped),and(status.eq.in_work,post_id.is.null)")
      .select(EVENT_COLUMNS),
    "claim for work",
  );
  return rows?.length ? mapEvent(rows[0]) : null;
}

/** "Пропустить": hides the event until a new development reopens it. Only a topic not yet in work. */
export async function skipEvent(number: number): Promise<NewsEvent | null> {
  const rows = check(
    await adminClient()
      .from("news_events")
      .update({ status: "skipped", skipped_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq("number", number)
      .in("status", ["new", "shown"])
      .select(EVENT_COLUMNS),
    "skip event",
  );
  return rows?.length ? mapEvent(rows[0]) : null;
}

/** "Вернуть": a skipped event goes back to "new", so the next digest shows it. */
export async function restoreEvent(number: number): Promise<NewsEvent | null> {
  const rows = check(
    await adminClient()
      .from("news_events")
      .update({ status: "new", skipped_at: null, updated_at: new Date().toISOString() })
      .eq("number", number)
      .eq("status", "skipped")
      .select(EVENT_COLUMNS),
    "restore event",
  );
  return rows?.length ? mapEvent(rows[0]) : null;
}

export const SKIPPED_DAYS = 30;
export const MAX_SKIPPED_LISTED = 20;

/** Skipped events of the last 30 days, the most recently skipped first. */
export async function listSkipped(now = new Date()): Promise<NewsEvent[]> {
  const since = new Date(now.getTime() - SKIPPED_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const rows = check(
    await adminClient()
      .from("news_events")
      .select(EVENT_COLUMNS)
      .eq("status", "skipped")
      .gte("skipped_at", since)
      .order("skipped_at", { ascending: false })
      .limit(MAX_SKIPPED_LISTED),
    "list skipped",
  );
  return (rows ?? []).map(mapEvent);
}

/**
 * Telegram did not take a digest message: the events of that run that were not delivered go back
 * to "new" so the repeated run shows them (and only them), and the run is marked as failed.
 */
export async function undoUndelivered(runId: string, numbers: number[]): Promise<void> {
  const db = adminClient();
  if (numbers.length > 0) {
    check(
      await db
        .from("news_events")
        .update({ status: "new", shown_at: null, shown_run_id: null, updated_at: new Date().toISOString() })
        .in("number", numbers)
        .eq("status", "shown")
        .eq("shown_run_id", runId),
      "undo undelivered",
    );
  }
  check(
    await db
      .from("news_runs")
      .update({ status: "failed", error_code: "telegram", finished_at: new Date().toISOString() })
      .eq("id", runId),
    "fail run delivery",
  );
}

/** The events a run showed (to send its digest again without duplicating anything in the database). */
export async function eventsOfRun(runId: string): Promise<NewsEvent[]> {
  const rows = check(
    await adminClient().from("news_events").select(EVENT_COLUMNS).eq("shown_run_id", runId).order("score", { ascending: false }),
    "events of run",
  );
  return (rows ?? []).map(mapEvent);
}

/* ---------- spending ---------- */

/** What the Scout's jobs cost since the start of the month (a share of the general budget). */
export async function scoutSpentSince(monthStartIso: string): Promise<number> {
  const db = adminClient();
  const jobs = check(await db.from("blog_agent_jobs").select("id").eq("kind", "scout").gte("created_at", monthStartIso), "scout jobs");
  const ids = (jobs ?? []).map((row: { id: number }) => row.id);
  if (ids.length === 0) return 0;
  const rows = check(await db.from("blog_ai_usage").select("cost_usd").in("job_id", ids), "scout usage");
  return (rows ?? []).reduce((sum: number, row: { cost_usd: number | string }) => sum + Number(row.cost_usd), 0);
}
