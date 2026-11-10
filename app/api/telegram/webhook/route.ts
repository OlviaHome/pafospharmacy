import { NextResponse } from "next/server";

import { adminActor, secretMatches, type TelegramUpdate } from "@/lib/editorial/auth";
import { handleUpdate } from "@/lib/editorial/bot";
import { EditorialConfigError, telegramConfig } from "@/lib/editorial/config";
import { markUpdateProcessed } from "@/lib/editorial/store";

export const maxDuration = 300;

const ok = () => NextResponse.json({ ok: true });

/**
 * Telegram webhook for the editorial bot.
 * 1. The X-Telegram-Bot-Api-Secret-Token header must equal TELEGRAM_WEBHOOK_SECRET (else 401).
 * 2. Only the configured admin in a private chat is served; everything else is silently ignored.
 * 3. Each update id is processed once, even if Telegram redelivers it.
 */
export async function POST(request: Request) {
  let config: ReturnType<typeof telegramConfig>;
  try {
    config = telegramConfig();
  } catch (error) {
    console.error("telegram webhook: misconfigured", error instanceof EditorialConfigError ? error.message : error);
    return NextResponse.json({ ok: false }, { status: 503 });
  }

  if (!secretMatches(request.headers.get("x-telegram-bot-api-secret-token"), config.webhookSecret)) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  let update: TelegramUpdate;
  try {
    update = (await request.json()) as TelegramUpdate;
  } catch {
    return ok();
  }
  if (typeof update?.update_id !== "number") return ok();

  if (!adminActor(update, config.adminId)) {
    // Not the admin: no reply at all, so the bot reveals nothing to strangers.
    return ok();
  }

  if (!(await markUpdateProcessed(update.update_id))) return ok();
  await handleUpdate(update);
  return ok();
}
