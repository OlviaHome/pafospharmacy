import { createHash } from "node:crypto";

import { runLoaderPreflight } from "@/lib/editorial/loader-preflight";

// TEMPORARY: one-off check of the source loader in a Preview deployment. Removed in the next commit.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const TOKEN_SHA256 = "b3081da732f57c9e650b4a5c29651be71fe6c54f2b533e10d4e84c0ae637d583";

export async function GET(request: Request) {
  const token = new URL(request.url).searchParams.get("t") ?? "";
  const allowed = process.env.VERCEL_ENV !== "production" && createHash("sha256").update(token).digest("hex") === TOKEN_SHA256;
  if (!allowed) return new Response(null, { status: 404 });
  return Response.json(await runLoaderPreflight());
}
