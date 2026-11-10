import { metadataBase } from "@/lib/i18n/metadata";

/**
 * Served as a route (not app/robots.ts) because the metadata API cannot emit Content-Signal.
 * Content-Signal (contentsignals.org) states that the site's text may be used for search and
 * for AI answers that cite it, but not for AI training.
 */
export function GET() {
  const body = [
    "User-Agent: *",
    "Content-Signal: ai-train=no, search=yes, ai-input=yes",
    "Allow: /",
    "Disallow: /api/",
    "",
    `Host: ${metadataBase.origin}`,
    `Sitemap: ${new URL("/sitemap.xml", metadataBase).toString()}`,
    "",
  ].join("\n");
  return new Response(body, {
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=3600" },
  });
}
