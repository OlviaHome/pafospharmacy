import { getCyprusDayWindow, localDateTimeToInstant } from "@/lib/domain/date";

/** "rewrite": a new article written from imported material (/import, mode A); "prepare": the editor's own text kept as it is (mode B). */
export type JobKind = "write" | "edit" | "translate" | "rewrite" | "prepare" | "scout";

/** A running job older than this is treated as dead (the function was killed). */
export const STALE_JOB_MS = 7 * 60 * 1000;

export interface UsageSnapshot {
  activeJobs: number;
  jobsToday: number;
  articlesToday: number;
  spentThisMonthUsd: number;
}

export interface LimitSettings {
  dailyArticles: number;
  dailyJobs: number;
  monthlyBudgetUsd: number;
  parallelJobs: number;
}

export type LimitDecision = { ok: true } | { ok: false; reason: string };

/** Pure decision whether one more job of this kind may start. Messages are for the editor. */
export function evaluateLimits(
  kind: JobKind,
  usage: UsageSnapshot,
  limits: LimitSettings,
  reservedUsd: number,
): LimitDecision {
  if (usage.spentThisMonthUsd + reservedUsd > limits.monthlyBudgetUsd) {
    return {
      ok: false,
      reason: `Месячный бюджет OpenAI почти исчерпан: потрачено ~$${usage.spentThisMonthUsd.toFixed(2)} из $${limits.monthlyBudgetUsd.toFixed(2)}. Лимит меняется переменной BLOG_MONTHLY_BUDGET_USD.`,
    };
  }
  if (usage.activeJobs >= limits.parallelJobs) {
    return {
      ok: false,
      reason: `Сейчас уже выполняется ${usage.activeJobs} задач(и) — это максимум одновременно. Попробуйте через пару минут.`,
    };
  }
  if (usage.jobsToday >= limits.dailyJobs) {
    return { ok: false, reason: `Дневной лимит задач (${limits.dailyJobs}) исчерпан. Продолжим завтра.` };
  }
  if ((kind === "write" || kind === "rewrite" || kind === "prepare") && usage.articlesToday >= limits.dailyArticles) {
    return { ok: false, reason: `Дневной лимит новых статей (${limits.dailyArticles}) исчерпан. Продолжим завтра.` };
  }
  return { ok: true };
}

export interface ScoutLimitSettings {
  scoutBudgetUsd: number;
  monthlyBudgetUsd: number;
  parallelJobs: number;
}

/** Why the Scout did not run, as the code stored with the run and the line the editor reads. */
export type ScoutLimitDecision = { ok: true } | { ok: false; code: "limit_scout" | "limit_total" | "busy"; reason: string };

const usd = (value: number) => `$${Number.isInteger(value) ? value : value.toFixed(2)}`;

/**
 * The Scout has its own monthly share (default $5) inside the general budget. The reservation is
 * checked before a run, so the last run of the month cannot overshoot by much.
 */
export function evaluateScoutLimits(
  usage: UsageSnapshot,
  scoutSpentUsd: number,
  limits: ScoutLimitSettings,
  reservedUsd: number,
): ScoutLimitDecision {
  if (scoutSpentUsd + reservedUsd > limits.scoutBudgetUsd) {
    return { ok: false, code: "limit_scout", reason: `исчерпан лимит ${usd(limits.scoutBudgetUsd)} на этот месяц` };
  }
  if (usage.spentThisMonthUsd + reservedUsd > limits.monthlyBudgetUsd) {
    return { ok: false, code: "limit_total", reason: `исчерпан общий месячный лимит ${usd(limits.monthlyBudgetUsd)}` };
  }
  if (usage.activeJobs >= limits.parallelJobs) {
    return { ok: false, code: "busy", reason: "сейчас выполняется максимум задач одновременно, повторите через пару минут" };
  }
  return { ok: true };
}

export function cyprusDayStart(now: Date): string {
  return getCyprusDayWindow(now).start;
}

export function cyprusMonthStart(now: Date): string {
  const [year, month] = getCyprusDayWindow(now).localDate.split("-").map(Number);
  return localDateTimeToInstant({ year, month, day: 1 }).toISOString();
}
