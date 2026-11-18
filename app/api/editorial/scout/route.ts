import { NextResponse } from "next/server";

import { secretMatches } from "@/lib/editorial/auth";
import { telegramConfig } from "@/lib/editorial/config";
import { startScoutJob } from "@/lib/editorial/pipeline";
import { sendMessage } from "@/lib/editorial/telegram";

export const maxDuration = 60;
// A scheduled call must never be served from a cache.
export const dynamic = "force-dynamic";

/**
 * The daily News Scout run, called by the Vercel scheduler (09:00 Europe/Nicosia; a second call a
 * little later only repeats a run that failed or was never delivered). Vercel sends
 * `Authorization: Bearer <CRON_SECRET>`; anything else is refused. A repeated call is harmless:
 * a finished run of the day is never started again (the run journal has a unique date).
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET?.trim() ?? "";
  // Without a configured secret the route is closed, never open.
  if (secret.length < 16) return NextResponse.json({ ok: false }, { status: 503 });
  const header = request.headers.get("authorization") ?? "";
  if (!header.startsWith("Bearer ") || !secretMatches(header.slice("Bearer ".length), secret)) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  try {
    const result = await startScoutJob({ kind: "real", trigger: "schedule" });
    return NextResponse.json({ ok: true, status: result.ok ? "started" : result.reason });
  } catch (error) {
    console.error("editorial: scheduled scout failed to start", error instanceof Error ? error.name : "unknown");
    // The run itself reports its failures; this is only a failure to start it at all.
    try {
      await sendMessage(Number(telegramConfig().adminId), "⚠️ Ежедневный мониторинг новостей не запустился. Повторить: /scout");
    } catch {
      // Telegram unreachable too: the status below makes the scheduler log a failed run.
    }
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
