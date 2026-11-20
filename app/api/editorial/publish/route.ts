import { NextResponse } from "next/server";

import { secretMatches } from "@/lib/editorial/auth";
import { runScheduledPublications } from "@/lib/editorial/bot";
import { editorialRuntimeAllowed } from "@/lib/editorial/config";

// Re-checking the sources of one article and publishing it can take a while.
export const maxDuration = 300;
// A scheduled call must never be served from a cache.
export const dynamic = "force-dynamic";

/**
 * The publication queue, called by the Vercel scheduler every 15 minutes (`publish-queue` in
 * vercel.json). Vercel sends `Authorization: Bearer <CRON_SECRET>`; anything else is refused.
 * Each call publishes at most one due article, with the same checks as the editor's button; a
 * repeated or simultaneous call never publishes twice (every step is a conditional update).
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET?.trim() ?? "";
  // Without a configured secret the route is closed, never open.
  if (secret.length < 16) return NextResponse.json({ ok: false }, { status: 503 });
  const header = request.headers.get("authorization") ?? "";
  if (!header.startsWith("Bearer ") || !secretMatches(header.slice("Bearer ".length), secret)) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  // Preview deployments never publish to the production blog.
  if (!editorialRuntimeAllowed()) return NextResponse.json({ ok: false }, { status: 503 });
  try {
    const summary = await runScheduledPublications();
    return NextResponse.json({ ok: true, ...summary });
  } catch (error) {
    console.error("editorial: publication queue failed", error instanceof Error ? error.message : "unknown");
    // Nothing was published by a failed call; the next call (in 15 minutes) tries again.
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
