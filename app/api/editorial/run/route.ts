import { after, NextResponse } from "next/server";

import { secretMatches } from "@/lib/editorial/auth";
// Imported for its side effect: registers the Telegram notifier used when a job finishes.
import "@/lib/editorial/bot";
import { telegramConfig } from "@/lib/editorial/config";
import { runJob } from "@/lib/editorial/pipeline";

export const maxDuration = 300;

/**
 * Internal job runner. Each call gets its own function invocation and time limit.
 * Callable only with the shared secret; the job is claimed atomically so it never runs twice.
 */
export async function POST(request: Request) {
  let secret: string;
  try {
    secret = telegramConfig().webhookSecret;
  } catch {
    return NextResponse.json({ ok: false }, { status: 503 });
  }
  if (!secretMatches(request.headers.get("x-editorial-secret"), secret)) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  const body = (await request.json().catch(() => null)) as { jobId?: unknown } | null;
  const jobId = Number(body?.jobId);
  if (!Number.isSafeInteger(jobId) || jobId <= 0) return NextResponse.json({ ok: false }, { status: 400 });

  after(() => runJob(jobId));
  return NextResponse.json({ ok: true }, { status: 202 });
}
