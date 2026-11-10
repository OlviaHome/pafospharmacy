import { getCyprusDayWindow, localDateTimeToInstant } from "@/lib/domain/date";

export type JobKind = "write" | "edit" | "translate";

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
  if (kind === "write" && usage.articlesToday >= limits.dailyArticles) {
    return { ok: false, reason: `Дневной лимит новых статей (${limits.dailyArticles}) исчерпан. Продолжим завтра.` };
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
