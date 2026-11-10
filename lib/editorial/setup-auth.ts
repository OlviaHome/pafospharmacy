import { secretMatches } from "./auth";

function bearer(request: Request): string | null {
  const value = request.headers.get("authorization");
  return value?.startsWith("Bearer ") ? value.slice(7).trim() : null;
}

/**
 * Who may run setup:
 * - `Authorization: Bearer <key>` with TELEGRAM_SETUP_KEY or TELEGRAM_WEBHOOK_SECRET;
 * - `?key=<TELEGRAM_SETUP_KEY>` for opening the link in a browser. The webhook secret is never
 *   accepted in the URL, because URLs end up in browser history and request logs.
 */
export function isAuthorizedSetupRequest(request: Request): boolean {
  const setupKey = process.env.TELEGRAM_SETUP_KEY?.trim() ?? "";
  const webhookSecret = process.env.TELEGRAM_WEBHOOK_SECRET?.trim() ?? "";
  const header = bearer(request);
  if (header) {
    if (setupKey.length >= 16 && secretMatches(header, setupKey)) return true;
    if (webhookSecret.length >= 16 && secretMatches(header, webhookSecret)) return true;
  }
  const query = new URL(request.url).searchParams.get("key");
  return Boolean(query && setupKey.length >= 16 && secretMatches(query, setupKey));
}
