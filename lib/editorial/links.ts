import "server-only";

import type { SourceCheck } from "./checks";

const USER_AGENT =
  "Mozilla/5.0 (compatible; HealthGuideCyprusLinkCheck/1.0; +https://healthguide.cy)";
const TIMEOUT_MS = 8_000;

async function probe(url: string, method: "HEAD" | "GET"): Promise<number> {
  const response = await fetch(url, {
    method,
    redirect: "follow",
    headers: { "User-Agent": USER_AGENT, Accept: "text/html,application/pdf,*/*" },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  // Don't download whole pages or PDFs: the status is enough.
  await response.body?.cancel().catch(() => undefined);
  return response.status;
}

/**
 * Checks whether each source URL opens. "broken" means the page is missing or the site is down;
 * "unverified" means the site refused an automated check (some government sites block bots).
 */
export async function checkSourceLinks(urls: string[]): Promise<SourceCheck[]> {
  const unique = [...new Set(urls)].slice(0, 15);
  const checkedAt = new Date().toISOString();
  return Promise.all(
    unique.map(async (url): Promise<SourceCheck> => {
      try {
        let status = await probe(url, "HEAD");
        // Many servers reject HEAD; ask again with GET before judging.
        if (status === 405 || status === 403 || status === 501 || status >= 500) status = await probe(url, "GET");
        if (status >= 200 && status < 400) return { url, state: "ok", status, checkedAt };
        if (status === 401 || status === 403 || status === 429) return { url, state: "unverified", status, checkedAt };
        return { url, state: "broken", status, checkedAt };
      } catch (error) {
        // A slow site is not proof of a broken link; DNS or TLS failures are.
        const timedOut = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
        return { url, state: timedOut ? "unverified" : "broken", status: null, checkedAt };
      }
    }),
  );
}
