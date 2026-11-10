import { NextResponse } from "next/server";

import { isAuthorizedSetupRequest } from "@/lib/editorial/setup-auth";

import {
  EditorialConfigError,
  openAiKey,
  openAiModel,
  siteOrigin,
  supabaseAdminConfig,
  telegramConfig,
  unsplashKey,
} from "@/lib/editorial/config";
import { adminClient } from "@/lib/editorial/store";
import { setWebhook, webhookInfo } from "@/lib/editorial/telegram";

type Check = { ok: boolean; detail: string };

function configCheck(read: () => unknown): Check {
  try {
    read();
    return { ok: true, detail: "configured" };
  } catch (error) {
    return { ok: false, detail: error instanceof EditorialConfigError ? error.message : "invalid" };
  }
}

const NO_STORE = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" };

/** Same answer for a missing route and a wrong key, so strangers learn nothing. */
function notFound() {
  return new Response(null, { status: 404, headers: NO_STORE });
}

export async function GET(request: Request) {
  return runSetup(request);
}

export async function POST(request: Request) {
  return runSetup(request);
}

/**
 * For the editor only: (re)registers the bot webhook at {SITE_URL}/api/telegram/webhook with the
 * configured secret and reports a health check. Idempotent; reveals no secret values.
 */
async function runSetup(request: Request) {
  if (!isAuthorizedSetupRequest(request)) return notFound();

  const checks: Record<string, Check> = {
    telegram_config: configCheck(telegramConfig),
    openai_key: configCheck(openAiKey),
    supabase_secret: configCheck(supabaseAdminConfig),
    stock_photos: { ok: true, detail: unsplashKey() ? "Unsplash" : "Openverse (no key needed)" },
  };

  if (checks.openai_key.ok) {
    try {
      // Free call: confirms the key works and the model is available to this account.
      const response = await fetch(`https://api.openai.com/v1/models/${encodeURIComponent(openAiModel())}`, {
        headers: { Authorization: `Bearer ${openAiKey()}` },
        signal: AbortSignal.timeout(10_000),
      });
      checks.openai_model = {
        ok: response.ok,
        detail: response.ok ? `${openAiModel()} available` : `${openAiModel()}: HTTP ${response.status}`,
      };
    } catch {
      checks.openai_model = { ok: false, detail: "OpenAI not reachable" };
    }
  }

  if (checks.supabase_secret.ok) {
    const { error } = await adminClient().from("blog_agent_jobs").select("id", { head: true, count: "exact" });
    checks.database = { ok: !error, detail: error ? `blog tables: ${error.message}` : "blog tables ready" };
    const bucket = await adminClient().storage.getBucket("blog-images");
    checks.storage = { ok: !bucket.error, detail: bucket.error ? bucket.error.message : "blog-images bucket ready" };
  }

  if (checks.telegram_config.ok) {
    const url = `${siteOrigin()}/api/telegram/webhook`;
    try {
      await setWebhook(url, telegramConfig().webhookSecret);
      const info = await webhookInfo();
      checks.telegram_webhook = {
        ok: info.url === url,
        detail: info.last_error_message
          ? `${info.url} (last error: ${info.last_error_message})`
          : `${info.url} (pending updates: ${info.pending_update_count})`,
      };
    } catch (error) {
      checks.telegram_webhook = { ok: false, detail: error instanceof Error ? error.message : "failed" };
    }
  }

  const ok = Object.values(checks).every((check) => check.ok);
  return NextResponse.json({ ok, checks }, { status: ok ? 200 : 500, headers: NO_STORE });
}
