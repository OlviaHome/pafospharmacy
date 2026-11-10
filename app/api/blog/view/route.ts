import { createClient } from "@supabase/supabase-js";

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const BOT = /bot|crawl|spider|slurp|preview|facebookexternalhit|headless|lighthouse/i;

const noContent = () => new Response(null, { status: 204 });

/**
 * Counts one article view. Only same-site browser requests are counted; bots, bad input and
 * unpublished articles are ignored silently. The count appears on the page with the next
 * blog cache refresh.
 */
export async function POST(request: Request) {
  if (request.headers.get("sec-fetch-site") !== "same-origin") return noContent();
  if (BOT.test(request.headers.get("user-agent") ?? "")) return noContent();

  const body = (await request.json().catch(() => null)) as { slug?: unknown } | null;
  const slug = typeof body?.slug === "string" ? body.slug : "";
  if (!SLUG.test(slug) || slug.length > 120) return noContent();

  const url = process.env.SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_PUBLISHABLE_KEY?.trim();
  if (!url || !key) return noContent();

  const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error } = await client.rpc("increment_blog_view", { post_slug: slug });
  if (error) console.error("blog view: increment failed", error.message);
  return noContent();
}
