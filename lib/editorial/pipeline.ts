import "server-only";

import { after } from "next/server";
import { randomUUID } from "node:crypto";

import type { Locale } from "@/lib/i18n/types";

import { editorialLimits, openAiModel, siteOrigin, telegramConfig } from "./config";
import type { SourceCheck } from "./checks";
import { materializeStock, removeStoredImage, searchStock } from "./images";
import { checkSourceLinks } from "./links";
import { evaluateLimits, type JobKind, type LimitDecision } from "./limits";
import { normalizeArticle, normalizeTranslation } from "./normalize";
import { callResponses, OpenAiError } from "./openai";
import { estimateCostUsd, reservedCostUsd } from "./pricing";
import {
  ARTICLE_SCHEMA,
  editInstructions,
  sourceKind,
  TRANSLATION_SCHEMA,
  translateInstructions,
  writeInstructions,
  type ArticleDraft,
  type ArticleImagePlan,
  type TranslationDraft,
} from "./prompts";
import { activeImages } from "./cards";
import {
  claimJob,
  enqueueJob,
  failStaleJobs,
  finishJob,
  loadPost,
  recordUsage,
  saveTranslation,
  setTranslationStatus,
  updatePost,
  uniqueSlug,
  upsertImage,
  usageSnapshot,
  type EditorialPost,
  type ImageRecord,
  type JobRecord,
} from "./store";

/** OpenAI calls must finish well inside the 300 s function limit. */
const WRITE_TIMEOUT_MS = 230_000;
const TRANSLATE_TIMEOUT_MS = 200_000;

export interface JobPayload {
  locales?: Locale[];
  instruction?: string;
  batchId?: string;
  /** What to send the editor when the job chain finishes. */
  notify?: "card" | "translations";
}

export type StartResult = (LimitDecision & { ok: true; jobId: number }) | (LimitDecision & { ok: false });

/**
 * Checks the limits and queues a job. Chained follow-up jobs of an already started article
 * (e.g. the English translation after writing) only respect the monthly budget.
 */
export async function startJob(
  postId: string,
  kind: JobKind,
  payload: JobPayload,
  options: { chained?: boolean; dispatch?: (jobId: number) => Promise<void> } = {},
): Promise<StartResult> {
  await failStaleJobs();
  const usage = await usageSnapshot();
  const limits = editorialLimits();
  const decision = options.chained
    ? evaluateLimits(kind, { ...usage, activeJobs: 0, jobsToday: 0, articlesToday: 0 }, limits, 0)
    : evaluateLimits(kind, usage, limits, reservedCostUsd(openAiModel(), kind));
  if (!decision.ok) return decision;
  const jobId = await enqueueJob(postId, kind, payload as Record<string, unknown>);
  await (options.dispatch ?? dispatchJob)(jobId);
  return { ok: true, jobId };
}

/**
 * Runs a job in its own function invocation (its own 300 s budget) by calling the runner route.
 * Falls back to running after the current response if the call fails.
 */
export async function dispatchJob(jobId: number): Promise<void> {
  try {
    const response = await fetch(`${siteOrigin()}/api/editorial/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-editorial-secret": telegramConfig().webhookSecret },
      body: JSON.stringify({ jobId }),
      signal: AbortSignal.timeout(15_000),
    });
    if (response.status === 202) return;
    console.error("editorial: runner returned", response.status);
  } catch (error) {
    console.error("editorial: runner dispatch failed", error);
  }
  // Fallback: run after the current response, inside this invocation's time limit.
  after(() => runJob(jobId));
}

/* ---------- notifications (injected by the bot to avoid an import cycle) ---------- */

export interface Notifier {
  card(post: EditorialPost): Promise<void>;
  translations(post: EditorialPost): Promise<void>;
  failure(post: EditorialPost, kind: JobKind, message: string): Promise<void>;
}

let notifier: Notifier | null = null;

export function setNotifier(value: Notifier): void {
  notifier = value;
}

/* ---------- runner ---------- */

export async function runJob(jobId: number): Promise<void> {
  const job = await claimJob(jobId);
  if (!job) return;
  const post = job.postId ? await loadPost({ id: job.postId }) : null;
  if (!post) {
    await finishJob(job.id, "failed", "post not found");
    return;
  }
  try {
    if (job.kind === "write") await runWrite(job, post);
    else if (job.kind === "translate") await runTranslate(job, post);
    else await runEdit(job, post);
    await finishJob(job.id, "done");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`editorial: job ${job.id} (${job.kind}) failed`, error);
    if (error instanceof OpenAiError && error.usage) {
      await recordUsage(job.id, openAiModel(), error.usage, estimateCostUsd(openAiModel(), error.usage)).catch(
        () => undefined,
      );
    }
    await finishJob(job.id, "failed", message).catch(() => undefined);
    // A failed article without text becomes "failed"; a failed edit or translation returns to review.
    const current = await loadPost({ id: post.id }).catch(() => null);
    const hasRussian = (current ?? post).translations.some((t) => t.locale === "ru");
    const stuck = (current ?? post).status === "generating";
    await updatePost(post.id, {
      last_error: message.slice(0, 1000),
      ...(stuck ? { status: hasRussian ? "review" : "failed" } : {}),
    }).catch(() => undefined);
    const fresh = (await loadPost({ id: post.id }).catch(() => null)) ?? post;
    await notifier?.failure(fresh, job.kind, message).catch(() => undefined);
  }
}

async function chain(postId: string, payload: JobPayload): Promise<void> {
  const result = await startJob(postId, "translate", payload, { chained: true });
  if (!result.ok) throw new Error(result.reason);
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

function sourceWarnings(sources: { url: string }[], citedUrls: string[], checks: SourceCheck[]): string[] {
  const warnings: string[] = [];
  const unofficial = sources.filter((source) => sourceKind(source.url) === "other");
  const broken = checks.filter((check) => check.state === "broken");
  const unverified = checks.filter((check) => check.state === "unverified");
  if (broken.length > 0) {
    warnings.push(
      `Ссылки не открываются: ${broken.map((check) => `${check.url}${check.status ? ` (${check.status})` : ""}`).join(", ")}.`,
    );
  }
  if (unverified.length > 0) {
    warnings.push(`Сайт не дал проверить ссылку, откройте вручную: ${unverified.map((check) => check.url).join(", ")}.`);
  }
  if (unofficial.length > 0) {
    warnings.push(
      `Неофициальные источники: ${unofficial.map((source) => hostOf(source.url)).join(", ")}.`,
    );
  }
  if (citedUrls.length > 0) {
    const seenHosts = new Set(citedUrls.flatMap((url) => {
      try {
        return [new URL(url).hostname.replace(/^www\./, "")];
      } catch {
        return [];
      }
    }));
    const unseen = sources.filter((source) => !seenHosts.has(hostOf(source.url).replace(/^www\./, "")));
    if (unseen.length > 0) {
      warnings.push(
        `Агент не открывал эти сайты при поиске, проверьте ссылки: ${unseen.map((s) => hostOf(s.url)).join(", ")}.`,
      );
    }
  }
  return warnings;
}

function notesFor(editorNotes: string, warnings: string[]): string | null {
  const text = [editorNotes, ...warnings].filter(Boolean).join("\n");
  return text ? text.slice(0, 3000) : null;
}

/** Checks every source link and stores the result for the pre-publish checks. */
export async function refreshSourceChecks(postId: string, urls: string[]): Promise<SourceCheck[]> {
  const checks = await checkSourceLinks(urls);
  await updatePost(postId, { source_checks: checks });
  return checks;
}

function slugWarning(choice: { slug: string; takenBy: { number: number; title: string } | null }): string[] {
  if (!choice.takenBy) return [];
  return [
    `Адрес уже занят статьёй #${choice.takenBy.number} «${choice.takenBy.title}» — возможно, это дубль. Новой статье дан адрес «${choice.slug}».`,
  ];
}

async function runWrite(job: JobRecord, post: EditorialPost): Promise<void> {
  const model = openAiModel();
  const result = await callResponses<ArticleDraft>({
    model,
    instructions: writeInstructions(new Date()),
    input: `Тема статьи от редактора: «${post.topic}»`,
    schemaName: "blog_article",
    schema: ARTICLE_SCHEMA,
    maxSearches: editorialLimits().maxSearchesPerArticle,
    maxOutputTokens: 24_000,
    reasoningEffort: "medium",
    timeoutMs: WRITE_TIMEOUT_MS,
  });
  await recordUsage(job.id, model, result.usage, result.costUsd);

  const article = normalizeArticle(result.data);
  const slugChoice = await uniqueSlug(article.slug || article.title, post.id);
  const batchId = randomUUID();
  await saveTranslation(
    post,
    "ru",
    {
      title: article.title,
      description: article.description,
      bodyMd: article.body_md,
      faq: article.faq,
      sources: article.sources,
    },
    "review",
    batchId,
    "generated",
  );
  await resolveImagePlans(post, article.images, []);
  const checks = await refreshSourceChecks(post.id, article.sources.map((source) => source.url));
  await updatePost(post.id, {
    slug: slugChoice.slug,
    last_error: null,
    editor_notes: notesFor(article.editor_notes, [
      ...slugWarning(slugChoice),
      ...article.warnings,
      ...sourceWarnings(article.sources, result.citedUrls, checks),
    ]),
  });
  await chain(post.id, { locales: ["en"], batchId, notify: "card" });
}

async function runEdit(job: JobRecord, post: EditorialPost): Promise<void> {
  const instruction = String((job.payload as JobPayload).instruction ?? "").trim();
  const russian = post.translations.find((t) => t.locale === "ru");
  if (!instruction) throw new Error("Пустая правка.");
  if (!russian) throw new Error("У статьи ещё нет русского текста.");

  const model = openAiModel();
  const current = {
    slug: post.slug,
    title: russian.title,
    description: russian.description,
    body_md: russian.bodyMd,
    faq: russian.faq,
    sources: russian.sources,
    images: activeImages(post).map((image) => ({
      slot: image.slot,
      kind: image.url ? "stock" : "screenshot",
      search_query: image.searchQuery ?? "",
      alt: image.alt.ru ?? "",
      note: image.placeholderNote ?? "",
    })),
    editor_notes: "",
  };
  const result = await callResponses<ArticleDraft>({
    model,
    instructions: editInstructions(new Date()),
    input: JSON.stringify({ editor_instruction: instruction, current_article: current }),
    schemaName: "blog_article",
    schema: ARTICLE_SCHEMA,
    maxSearches: 4,
    maxOutputTokens: 24_000,
    reasoningEffort: "medium",
    timeoutMs: WRITE_TIMEOUT_MS,
  });
  await recordUsage(job.id, model, result.usage, result.costUsd);

  const article = normalizeArticle(result.data);
  const batchId = randomUUID();
  await saveTranslation(
    post,
    "ru",
    {
      title: article.title,
      description: article.description,
      bodyMd: article.body_md,
      faq: article.faq,
      sources: article.sources,
    },
    "review",
    batchId,
    `edit: ${instruction.slice(0, 200)}`,
  );
  await resolveImagePlans(post, article.images, post.images);

  // Other languages no longer match the Russian text; they are re-translated after publication.
  const outdated = post.translations
    .map((t) => t.locale)
    .filter((locale): locale is Locale => locale !== "ru" && locale !== "en");
  await setTranslationStatus(post.id, outdated, "draft");
  const checks = await refreshSourceChecks(post.id, article.sources.map((source) => source.url));
  await updatePost(post.id, {
    status: "review",
    last_error: null,
    editor_notes: notesFor(article.editor_notes, [
      ...article.warnings,
      ...sourceWarnings(article.sources, result.citedUrls, checks),
    ]),
  });
  await chain(post.id, { locales: ["en"], batchId, notify: "card" });
}

async function runTranslate(job: JobRecord, post: EditorialPost): Promise<void> {
  const payload = job.payload as JobPayload;
  const locales = (payload.locales ?? ["en"]).filter((locale) => locale !== "ru");
  const batchId = payload.batchId ?? randomUUID();
  const model = openAiModel();

  const translatedAlts: { locale: Locale; slot: string; alt: string }[] = [];
  await Promise.all(
    locales.map(async (locale) => {
      // English is translated from the Russian master; Greek and Arabic from English.
      const source =
        (locale !== "en" ? post.translations.find((t) => t.locale === "en") : undefined) ??
        post.translations.find((t) => t.locale === "ru");
      if (!source) throw new Error("Нет исходного текста для перевода.");
      const result = await callResponses<TranslationDraft>({
        model,
        instructions: translateInstructions(locale),
        input: JSON.stringify({
          source_language: source.locale,
          article: {
            title: source.title,
            description: source.description,
            body_md: source.bodyMd,
            faq: source.faq,
            sources: source.sources,
          },
          image_slots: post.images.map((image) => ({
            slot: image.slot,
            alt: image.alt[source.locale] ?? image.alt.ru ?? "",
          })),
        }),
        schemaName: "blog_translation",
        schema: TRANSLATION_SCHEMA,
        maxSearches: 0,
        maxOutputTokens: 16_000,
        reasoningEffort: "low",
        timeoutMs: TRANSLATE_TIMEOUT_MS,
      });
      await recordUsage(job.id, model, result.usage, result.costUsd);
      const translation = normalizeTranslation(result.data, source.bodyMd);
      await saveTranslation(
        post,
        locale,
        {
          title: translation.title,
          description: translation.description,
          bodyMd: translation.body_md,
          faq: translation.faq,
          sources: translation.sources,
        },
        "review",
        batchId,
        `translated from ${source.locale}`,
      );
      for (const { slot, alt } of translation.image_alts) {
        if (alt.trim()) translatedAlts.push({ locale, slot, alt: alt.trim() });
      }
    }),
  );
  // Merge alt texts after all languages finish so parallel translations don't overwrite each other.
  for (const image of post.images) {
    const additions = translatedAlts.filter((entry) => entry.slot === image.slot);
    if (additions.length === 0) continue;
    const alt = { ...image.alt, ...Object.fromEntries(additions.map((entry) => [entry.locale, entry.alt])) };
    await upsertImage(post.id, image.slot, { alt });
  }

  if (post.status === "generating") await updatePost(post.id, { status: "review", last_error: null });
  let fresh = await loadPost({ id: post.id });
  if (!fresh) return;
  // Translations may cite a URL the Russian text does not; check only the new ones.
  const known = new Set(fresh.sourceChecks.map((check) => check.url));
  const newUrls = fresh.translations.flatMap((t) => t.sources.map((s) => s.url)).filter((url) => !known.has(url));
  if (newUrls.length > 0) {
    const added = await checkSourceLinks(newUrls);
    await updatePost(post.id, { source_checks: [...fresh.sourceChecks, ...added] });
    fresh = (await loadPost({ id: post.id })) ?? fresh;
  }
  if (!notifier) return;
  if (payload.notify === "translations") await notifier.translations(fresh);
  else await notifier.card(fresh);
}

/* ---------- images ---------- */

async function stockFields(post: EditorialPost, plan: ArticleImagePlan, tried: string[], alt: ImageRecord["alt"]) {
  const candidate = await searchStock(plan.search_query, tried);
  if (!candidate) return null;
  const stored = await materializeStock(candidate, post.id, plan.slot);
  return {
    url: stored.url,
    width: stored.width || null,
    height: stored.height || null,
    alt,
    placeholder_note: null,
    source: candidate.provider,
    credit_name: candidate.creditName,
    credit_url: candidate.creditUrl,
    source_page_url: candidate.sourcePageUrl,
    license_name: candidate.licenseName,
    license_url: candidate.licenseUrl,
    provider_photo_id: candidate.id,
    tried_photo_ids: [...tried, `${candidate.provider}:${candidate.id}`],
    search_query: plan.search_query,
    storage_path: stored.storagePath,
  };
}

function placeholderFields(note: string, alt: ImageRecord["alt"], query: string | null) {
  return {
    url: null,
    width: null,
    height: null,
    alt,
    placeholder_note: note.slice(0, 500),
    source: "placeholder" as const,
    credit_name: null,
    credit_url: null,
    source_page_url: null,
    license_name: null,
    license_url: null,
    provider_photo_id: null,
    storage_path: null,
    search_query: query,
  };
}

/**
 * Creates or updates image slots from the plan; existing real images are kept. Slots an edit
 * no longer uses are kept too (they are simply not rendered), so rolling the edit back
 * brings its images back.
 */
async function resolveImagePlans(
  post: EditorialPost,
  plans: ArticleImagePlan[],
  existing: ImageRecord[],
): Promise<void> {
  await Promise.all(
    plans.map(async (plan) => {
      const current = existing.find((image) => image.slot === plan.slot);
      const alt = { ...(current?.alt ?? {}), ru: plan.alt || current?.alt.ru || "" };
      if (current?.url) {
        await upsertImage(post.id, plan.slot, { alt });
        return;
      }
      if (plan.kind === "screenshot") {
        await upsertImage(post.id, plan.slot, placeholderFields(plan.note || "скриншот", alt, null));
        return;
      }
      try {
        const fields = await stockFields(post, plan, current?.triedPhotoIds ?? [], alt);
        await upsertImage(
          post.id,
          plan.slot,
          fields ??
            placeholderFields(`не нашлась стоковая картинка по запросу «${plan.search_query}»`, alt, plan.search_query),
        );
      } catch (error) {
        console.error("editorial: stock image failed", error);
        await upsertImage(
          post.id,
          plan.slot,
          placeholderFields(`стоковая картинка не загрузилась («${plan.search_query}»)`, alt, plan.search_query),
        );
      }
    }),
  );
}

/** Replaces one slot with the next stock photo for its (or a new) query. */
export async function nextStockImage(post: EditorialPost, slot: string, query?: string): Promise<boolean> {
  const image = post.images.find((candidate) => candidate.slot === slot);
  if (!image) throw new Error("Нет такого места для картинки.");
  const searchQuery = (query ?? image.searchQuery ?? "").trim();
  if (!searchQuery) throw new Error("NO_QUERY");
  const fields = await stockFields(
    post,
    { slot, kind: "stock", search_query: searchQuery, alt: image.alt.ru ?? "", note: "" },
    image.triedPhotoIds,
    image.alt,
  );
  if (!fields) return false;
  await removeStoredImage(image.storagePath);
  await upsertImage(post.id, slot, fields);
  return true;
}
