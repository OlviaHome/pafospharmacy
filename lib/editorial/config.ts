import "server-only";

import { PRODUCTION_URL } from "@/lib/i18n/metadata";

function intFromEnv(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(value)));
}

function numberFromEnv(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

/**
 * Spending and volume guards. Defaults are deliberately small; each can be raised in Vercel.
 * Hard caps (the max arguments) cannot be exceeded even by a misconfigured variable.
 */
export function editorialLimits() {
  return {
    /** New articles (and regenerations) per Cyprus calendar day. */
    dailyArticles: intFromEnv("BLOG_DAILY_ARTICLE_LIMIT", 5, 0, 20),
    /** All OpenAI jobs (write, edit, translate) per Cyprus calendar day. */
    dailyJobs: intFromEnv("BLOG_DAILY_JOB_LIMIT", 40, 0, 150),
    /** Estimated OpenAI spend per Cyprus calendar month, in USD. */
    monthlyBudgetUsd: numberFromEnv("BLOG_MONTHLY_BUDGET_USD", 10, 0, 100),
    /** Jobs running at the same time. */
    parallelJobs: intFromEnv("BLOG_MAX_PARALLEL_JOBS", 3, 1, 5),
    /** Web searches the model may run while writing one article. */
    maxSearchesPerArticle: intFromEnv("BLOG_MAX_SEARCHES_PER_ARTICLE", 8, 1, 15),
  };
}

export function openAiModel(): string {
  return process.env.OPENAI_MODEL?.trim() || "gpt-5.6-terra";
}

export function siteOrigin(): string {
  return (process.env.SITE_URL?.trim() || PRODUCTION_URL).replace(/\/$/, "");
}

export class EditorialConfigError extends Error {}

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new EditorialConfigError(`${name} is not configured.`);
  return value;
}

export function telegramConfig() {
  const adminId = required("TELEGRAM_ADMIN_ID");
  if (!/^\d{1,20}$/.test(adminId)) {
    throw new EditorialConfigError("TELEGRAM_ADMIN_ID must be a numeric Telegram user id.");
  }
  const webhookSecret = required("TELEGRAM_WEBHOOK_SECRET");
  // Telegram allows 1–256 characters of A–Z, a–z, 0–9, _ and -.
  if (!/^[A-Za-z0-9_-]{16,256}$/.test(webhookSecret)) {
    throw new EditorialConfigError(
      "TELEGRAM_WEBHOOK_SECRET must be 16–256 characters of letters, digits, _ or -.",
    );
  }
  return { botToken: required("TELEGRAM_BOT_TOKEN"), adminId, webhookSecret };
}

export function openAiKey(): string {
  return required("OPENAI_API_KEY");
}

export function supabaseAdminConfig() {
  return { url: required("SUPABASE_URL"), secretKey: required("SUPABASE_SECRET_KEY") };
}

export function unsplashKey(): string | null {
  return process.env.UNSPLASH_ACCESS_KEY?.trim() || null;
}
