import "server-only";

import { guardedFetch, isGuardedFetchError } from "guarded-fetch";

/**
 * The only way the editorial bot requests a URL chosen by the model or typed by the editor
 * (article sources). Built on Vercel's guarded-fetch, which:
 * - resolves the host and refuses loopback, private, link-local, CGNAT and metadata addresses,
 *   IPv4 and IPv6, including IPv4 hidden inside IPv6;
 * - connects to the very address it checked (no second DNS answer: DNS rebinding);
 * - follows redirects itself and runs every check again on each hop.
 * On top of that this module allows https only, at most 5 redirects, and one time budget for
 * the whole request including the body.
 */

export const MAX_REDIRECTS = 5;

export type SafeFetchReason = "not_allowed" | "timeout" | "redirects" | "network";

export class SafeFetchError extends Error {
  constructor(
    readonly reason: SafeFetchReason,
    message: string,
  ) {
    super(message);
    this.name = "SafeFetchError";
  }
}

/** Only public https hosts by name; no IP literals, credentials or local names. Addresses are checked by DNS later. */
export function isFetchableSourceUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" || url.username || url.password) return false;
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (!host.includes(".") || /^[\d.]+$/.test(host) || host.includes(":") || host.startsWith("[")) return false;
  return !/(^|\.)(localhost|local|internal|lan|home|corp)$/.test(host);
}

export interface SafeFetchOptions {
  method?: "GET" | "HEAD";
  headers?: Record<string, string>;
  /** Budget for DNS, connection, every redirect and reading the body. */
  timeoutMs: number;
  /** Tests only: replaces the network transport. Address checks and redirect rules still run. */
  transport?: typeof fetch;
}

/** Requests a public https URL. Throws SafeFetchError; never returns a response from an internal address. */
export async function safeFetch(url: string, options: SafeFetchOptions): Promise<Response> {
  if (!isFetchableSourceUrl(url)) throw new SafeFetchError("not_allowed", "address is not allowed");
  const deadline = AbortSignal.timeout(options.timeoutMs);
  let response: Response;
  try {
    response = await guardedFetch(url, {
      method: options.method ?? "GET",
      headers: options.headers,
      httpsOnly: true,
      redirect: "follow",
      maxRedirects: MAX_REDIRECTS,
      timeoutMs: options.timeoutMs,
      // guarded-fetch stops its own clock at the headers; this signal also cuts off a slow body.
      signal: deadline,
      ...(options.transport ? { fetch: options.transport } : {}),
    });
  } catch (error) {
    if (deadline.aborted) throw new SafeFetchError("timeout", "timeout");
    if (isGuardedFetchError(error)) {
      switch (error.code) {
        case "invalid_url":
        case "protocol_not_allowed":
        case "host_not_allowed":
        case "hostname_unsafe":
        case "redirect_to_unsafe_host":
          throw new SafeFetchError("not_allowed", error.code);
        case "too_many_redirects":
        case "redirect_invalid":
        case "redirect_not_allowed":
          throw new SafeFetchError("redirects", error.code);
        case "timeout":
          throw new SafeFetchError("timeout", error.code);
        default:
          throw new SafeFetchError("network", error.code);
      }
    }
    const name = error instanceof Error ? error.name : "";
    throw new SafeFetchError(name === "TimeoutError" || name === "AbortError" ? "timeout" : "network", name || "error");
  }
  if (response.url && !isFetchableSourceUrl(response.url)) {
    await response.body?.cancel().catch(() => undefined);
    throw new SafeFetchError("not_allowed", "final address is not allowed");
  }
  return response;
}
