import "server-only";

import { editorialLimits, scoutModel } from "./config";
import { cyprusMonthStart, evaluateScoutLimits } from "./limits";
import { OpenAiError, callResponses } from "./openai";
import {
  cyprusDate,
  dedupeItems,
  pickDigest,
  planSelection,
  scoutReservedUsd,
  windowStart,
  type KnownEvent,
  type SelectionAction,
} from "./scout";
import {
  OFFICIAL_SEARCH_SCHEMA,
  SCOUT_SELECTION_SCHEMA,
  officialSearchInput,
  officialSearchInstructions,
  scoutSelectionInput,
  scoutSelectionInstructions,
  type OfficialSearchResult,
  type SelectionResult,
} from "./scout-prompts";
import { FAILURE_REASON, type DigestTopic, type ScoutErrorCode, type ScoutOutcome, type UnavailableSource } from "./scout-render";
import { acceptOfficialItems, readFeed, defaultFetcher, type CollectedItem, type Fetcher } from "./scout-sources";
import {
  attachItems,
  claimRun,
  claimShown,
  createEvent,
  discardStaleItems,
  finishRun,
  insertItems,
  lastSuccessfulRunStart,
  listNewEvents,
  listSources,
  markItemsProcessed,
  pendingItems,
  recentEvents,
  recordSourceCheck,
  reopenEvent,
  scoutSpentSince,
  type EventFields,
  type NewsEvent,
  type NewsItem,
  type NewsSource,
  type RunKind,
} from "./scout-store";
import { recordUsage, usageSnapshot } from "./store";

const SEARCH_TIMEOUT_MS = 100_000;
const SELECTION_TIMEOUT_MS = 100_000;
/** The most publications one selection call sees (the cost cap of the input). */
export const MAX_ITEMS_PER_RUN = 150;
const MAX_SEARCHES = 5;
const RECENT_EVENT_DAYS = 30;

export interface ScoutOptions {
  jobId: number;
  kind: RunKind;
  trigger: "manual" | "schedule";
  /** A test run may name another model to compare it with the default. */
  model?: string;
  now?: Date;
  /** Tests only. */
  fetcher?: Fetcher;
}

function failed(test: boolean, code: ScoutErrorCode, unavailable: UnavailableSource[], reason?: string): ScoutOutcome {
  return { kind: "failed", test, code, reason: reason ?? FAILURE_REASON[code], unavailable };
}

function linksOf(itemIds: string[], items: Map<string, NewsItem>): { title: string; url: string }[] {
  return itemIds
    .map((id) => items.get(id))
    .filter((item): item is NewsItem => Boolean(item))
    .slice(0, 5)
    .map((item) => ({ title: item.title.slice(0, 120), url: item.url }));
}

function topicOf(event: NewsEvent): DigestTopic {
  return {
    number: event.number,
    title: event.titleRu,
    gist: event.gist,
    why: event.why,
    score: event.score,
    scoreReason: event.scoreReason,
    links: event.links,
    firstSeenAt: event.firstSeenAt,
  };
}

/**
 * One Scout run: collect, choose, record. The result is what the editor is told; it is also
 * everything the run leaves outside the database. It never throws (an unexpected error becomes a
 * failed run with a short code) except when the run record itself cannot be taken. Returns null
 * when the run of this day and kind was already done or is running: a repeated call is a no-op.
 *
 * A test run reads the same sources (all of them, approved or not) and records only its own run
 * row and the sources' access results: no publications, no events, nothing shown.
 */
export async function runScout(options: ScoutOptions): Promise<ScoutOutcome | null> {
  const now = options.now ?? new Date();
  const test = options.kind === "test";
  const model = test && options.model ? options.model : scoutModel();
  const date = cyprusDate(now);

  const claim = await claimRun(date, options.kind, options.trigger, model);
  if (claim.status !== "claimed") return null;
  const unavailable: UnavailableSource[] = [];
  const finish = async (outcome: ScoutOutcome, stats: Record<string, unknown> = {}) => {
    await finishRun(claim.runId, outcome.kind === "failed" ? "failed" : "done", outcome.kind === "failed" ? outcome.code : null, {
      model,
      unavailable: unavailable.length,
      ...stats,
    }).catch((error) => console.error("scout: finish run failed", error instanceof Error ? error.message : "unknown"));
    return outcome;
  };

  try {
    // 1. Limits: the Scout's own share first, then the general budget.
    const limits = editorialLimits();
    const usage = await usageSnapshot(now);
    const decision = evaluateScoutLimits(
      // This job is itself one of the active ones.
      { ...usage, activeJobs: Math.max(0, usage.activeJobs - 1) },
      await scoutSpentSince(cyprusMonthStart(now)),
      limits,
      scoutReservedUsd(model),
    );
    if (!decision.ok) return finish(failed(test, decision.code, [], decision.reason));

    // 2. Sources.
    const all = await listSources();
    const sources = test ? all : all.filter((source) => source.enabled);
    if (sources.length === 0) return finish(failed(test, "no_sources", []));
    const feeds = sources.filter((source) => source.kind === "rss");
    const searches = sources.filter((source) => source.kind === "search");
    const fetcher = options.fetcher ?? defaultFetcher;

    const since = windowStart(test ? null : await lastSuccessfulRunStart(), now);

    // 3. Collection without AI: feeds, one by one; a failing source is recorded and skipped.
    const collected: CollectedItem[] = [];
    let sourcesWorking = 0;
    await Promise.all(
      feeds.map(async (source) => {
        const read = await readFeed(source.url, fetcher);
        if (read.ok) {
          sourcesWorking += 1;
          for (const item of read.items) collected.push({ sourceId: source.id, ...item });
          await recordSourceCheck(source.id, read.items.length ? "ok" : "empty", `публикаций в ленте: ${read.items.length}`).catch(() => undefined);
        } else {
          unavailable.push({ name: source.name, code: read.code });
          console.error(`scout: source ${source.number} failed: ${read.code}`);
          await recordSourceCheck(source.id, read.state, read.code).catch(() => undefined);
        }
      }),
    );

    // 4. Official domains: one restricted search (gov.cy and others refuse direct reading).
    if (searches.length > 0) {
      try {
        const result = await callResponses<OfficialSearchResult>({
          model,
          instructions: officialSearchInstructions(since.toISOString().slice(0, 10)),
          input: officialSearchInput(
            searches.map((source) => source.url),
            since.toISOString().slice(0, 10),
          ),
          schemaName: "scout_official_search",
          schema: OFFICIAL_SEARCH_SCHEMA,
          maxSearches: MAX_SEARCHES,
          allowedDomains: searches.map((source) => source.url),
          maxOutputTokens: 6_000,
          reasoningEffort: "low",
          timeoutMs: SEARCH_TIMEOUT_MS,
        });
        await recordUsage(options.jobId, model, result.usage, result.costUsd);
        sourcesWorking += 1;
        collected.push(...acceptOfficialItems(result.data, searches));
      } catch (error) {
        if (error instanceof OpenAiError && error.usage) {
          await recordUsage(options.jobId, model, error.usage, 0).catch(() => undefined);
        }
        unavailable.push({ name: "поиск по официальным сайтам", code: "openai" });
        console.error("scout: official search failed");
      }
    }
    if (sourcesWorking === 0) return finish(failed(test, "all_sources_down", unavailable));

    // 5. Technical duplicates out, then store (a real run) and take what no selection has seen yet.
    const fresh = dedupeItems(collected).filter((item) => !item.publishedAt || Date.parse(item.publishedAt) >= since.getTime());
    let items: NewsItem[];
    if (test) {
      items = fresh.slice(0, MAX_ITEMS_PER_RUN).map((item, index) => ({ id: `t${index + 1}`, ...item, sourceId: item.sourceId }));
    } else {
      await insertItems(fresh);
      await discardStaleItems(since);
      items = await pendingItems(since, MAX_ITEMS_PER_RUN);
    }

    // 6. One selection call over the new publications and the last 30 days of events.
    const sourceNames = new Map(all.map((source) => [source.id, source.name]));
    const recent = await recentEvents(new Date(now.getTime() - RECENT_EVENT_DAYS * 24 * 60 * 60 * 1000).toISOString());
    const known = new Map<string, KnownEvent>(recent.map((event) => [event.id, { id: event.id, status: event.status }]));
    let actions: SelectionAction[] = [];
    if (items.length > 0) {
      let selection: SelectionResult;
      try {
        const result = await callResponses<SelectionResult>({
          model,
          instructions: scoutSelectionInstructions(date),
          input: scoutSelectionInput(
            items.map((item) => ({
              id: item.id,
              source: (item.sourceId && sourceNames.get(item.sourceId)) || "официальный сайт",
              title: item.title,
              summary: item.summary,
              url: item.url,
              published: item.publishedAt?.slice(0, 10) ?? "",
            })),
            recent.map((event) => ({
              id: event.id,
              title: event.titleRu,
              status: event.status,
              shown: event.shownAt?.slice(0, 10) ?? "",
            })),
          ),
          schemaName: "scout_selection",
          schema: SCOUT_SELECTION_SCHEMA,
          maxSearches: 0,
          maxOutputTokens: 8_000,
          reasoningEffort: "medium",
          timeoutMs: SELECTION_TIMEOUT_MS,
        });
        await recordUsage(options.jobId, model, result.usage, result.costUsd);
        selection = result.data;
      } catch (error) {
        if (error instanceof OpenAiError && error.usage) {
          await recordUsage(options.jobId, model, error.usage, 0).catch(() => undefined);
        }
        console.error("scout: selection failed");
        return finish(failed(test, "openai", unavailable), { items: items.length });
      }
      actions = planSelection(selection, { itemIds: new Set(items.map((item) => item.id)), known }).actions;
    }

    // 7. Record (a real run) and build the digest.
    const byId = new Map(items.map((item) => [item.id, item]));
    let topics: DigestTopic[];
    if (test) {
      const shown = actions.flatMap((action) =>
        action.kind === "attach"
          ? []
          : [{ number: null, title: action.event.title, gist: action.event.gist, why: action.event.why, score: action.event.score, scoreReason: action.event.scoreReason, links: linksOf(action.itemIds, byId), firstSeenAt: now.toISOString() }],
      );
      topics = pickDigest(shown.map((topic) => ({ ...topic, firstSeenAt: topic.firstSeenAt })));
    } else {
      for (const action of actions) {
        const fields = (event: { title: string; gist: string; why: string; score: number; scoreReason: string }): EventFields => ({
          ...event,
          links: linksOf(action.itemIds, byId),
        });
        let eventId: string;
        if (action.kind === "new") eventId = await createEvent(fields(action.event));
        else {
          eventId = action.eventId;
          if (action.kind === "update") await reopenEvent(eventId, fields(action.event));
        }
        await attachItems(eventId, action.itemIds);
      }
      await markItemsProcessed(items.map((item) => item.id));
      // Everything waiting in "new" (also what an earlier digest had no room for), best first.
      const chosen = pickDigest(await listNewEvents());
      topics = (await claimShown(chosen.map((event) => event.id), claim.runId)).map(topicOf);
      topics.sort((a, b) => b.score - a.score);
    }

    const stats = { items: items.length, selected: actions.length, shown: topics.length };
    if (topics.length === 0) {
      return finish({ kind: "empty", test, unavailable, collected: items.length, model }, stats);
    }
    return finish({ kind: "topics", test, topics, unavailable, collected: items.length, model }, stats);
  } catch (error) {
    console.error("scout: run failed", error instanceof Error ? error.name : "unknown");
    return finish(failed(test, "internal", unavailable));
  }
}

export type { NewsSource };
