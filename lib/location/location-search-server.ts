import "server-only";

import { createHmac } from "node:crypto";
import { isIP } from "node:net";
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import { getCache, ipAddress } from "@vercel/functions";

import {
  buildGeoapifySearchUrl,
  buildManualLocationQuery,
  manualLocationSuggestions,
  type GeoapifyResponse,
  type ManualLocationSuggestion,
} from "@/lib/geocoding/geoapify";
import {
  MANUAL_SUGGESTION_LIMIT,
  MINIMUM_MANUAL_QUERY_CHARACTERS,
  normalizeManualLocationQuery,
} from "@/lib/location/manual-search";

export const LOCATION_SEARCH_MAX_BODY_BYTES = 1024;
export const LOCATION_SEARCH_MAX_QUERY_CHARACTERS = 120;
export const LOCATION_SEARCH_CACHE_SECONDS = 300;
export const LOCATION_SEARCH_RATE_LIMIT_WINDOW_SECONDS = 300;
export const LOCATION_SEARCH_RATE_LIMIT_MAX_CLIENT_MISSES = 3;
export const LOCATION_SEARCH_RATE_LIMIT_MAX_PROVIDER_MISSES = 8;

const LOCATION_SEARCH_RATE_LIMIT_KEY = "paphos-location-search";
const LOCATION_SEARCH_CACHE_NAMESPACE = "paphos-location-search-v2";

export class LocationSearchRequestError extends Error {
  constructor(
    readonly status: 400 | 403 | 413 | 415,
    message: string,
  ) {
    super(message);
    this.name = "LocationSearchRequestError";
  }
}

export class LocationSearchProviderError extends Error {
  constructor(readonly status: 429 | 502 | 503) {
    super("Location search provider request failed.");
    this.name = "LocationSearchProviderError";
  }
}

export type LocationSearchBudgetStatus =
  | "allowed"
  | "rate_limited"
  | "unavailable";

function canonicalQuery(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/gu, " ");
}

function validateBrowserRequest(request: Request): void {
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite !== null && fetchSite.toLocaleLowerCase("en") !== "same-origin") {
    throw new LocationSearchRequestError(
      403,
      "Location search request was not allowed.",
    );
  }

  const origin = request.headers.get("origin");
  if (origin === null) return;

  let parsedOrigin: string;
  try {
    parsedOrigin = new URL(origin).origin;
  } catch {
    throw new LocationSearchRequestError(
      403,
      "Location search request was not allowed.",
    );
  }

  if (origin === "null" || parsedOrigin !== new URL(request.url).origin) {
    throw new LocationSearchRequestError(
      403,
      "Location search request was not allowed.",
    );
  }
}

function validateContentType(request: Request): void {
  const mediaType = request.headers
    .get("content-type")
    ?.split(";", 1)[0]
    .trim()
    .toLocaleLowerCase("en");
  if (mediaType !== "application/json") {
    throw new LocationSearchRequestError(
      415,
      "Location search requires application/json.",
    );
  }
}

async function readBoundedBody(request: Request): Promise<string> {
  const contentLength = request.headers.get("content-length");
  if (contentLength !== null) {
    if (!/^\d+$/.test(contentLength)) {
      throw new LocationSearchRequestError(400, "Enter a valid location search.");
    }
    if (Number(contentLength) > LOCATION_SEARCH_MAX_BODY_BYTES) {
      throw new LocationSearchRequestError(
        413,
        "Location search request is too large.",
      );
    }
  }

  if (!request.body) {
    throw new LocationSearchRequestError(400, "Enter a valid location search.");
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    byteLength += value.byteLength;
    if (byteLength > LOCATION_SEARCH_MAX_BODY_BYTES) {
      await reader.cancel().catch(() => undefined);
      throw new LocationSearchRequestError(
        413,
        "Location search request is too large.",
      );
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new LocationSearchRequestError(400, "Enter a valid location search.");
  }
}

export async function parseLocationSearchRequest(request: Request): Promise<string> {
  validateBrowserRequest(request);
  validateContentType(request);

  let body: unknown;
  try {
    body = JSON.parse(await readBoundedBody(request)) as unknown;
  } catch (error) {
    if (error instanceof LocationSearchRequestError) throw error;
    throw new LocationSearchRequestError(400, "Enter a valid location search.");
  }

  if (
    typeof body !== "object" ||
    body === null ||
    Array.isArray(body) ||
    Object.keys(body).length !== 1 ||
    !("query" in body) ||
    typeof body.query !== "string"
  ) {
    throw new LocationSearchRequestError(400, "Enter a valid location search.");
  }

  const query = canonicalQuery(body.query);
  const normalizedQuery = normalizeManualLocationQuery(query);
  if (
    normalizedQuery.length < MINIMUM_MANUAL_QUERY_CHARACTERS ||
    normalizedQuery.length > LOCATION_SEARCH_MAX_QUERY_CHARACTERS
  ) {
    throw new LocationSearchRequestError(
      400,
      "Enter between 3 and 120 characters.",
    );
  }

  return normalizedQuery;
}

export async function checkLocationSearchBudget(
  request: Request,
): Promise<LocationSearchBudgetStatus> {
  try {
    // ipAddress reads a platform header, not an authenticated identity outside
    // Vercel's ingress. Never fall back to caller-supplied forwarding headers.
    if (process.env.VERCEL !== "1") return "unavailable";
    const ip = normalizedClientIp(ipAddress(request));
    const secret = process.env.LOCATION_SEARCH_HMAC_SECRET?.trim();
    const url = process.env.UPSTASH_REDIS_REST_URL?.trim();
    const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();
    if (!ip || !secret || Buffer.byteLength(secret) < 32 || !url || !token) {
      return "unavailable";
    }

    const identifier = createHmac("sha256", secret)
      .update(`paphos-location-search:client:${ip}`)
      .digest("hex");
    const redis = new Redis({ url, token });
    const options = {
      redis,
      analytics: false,
      ephemeralCache: false as const,
      timeout: 1_000,
    };
    const client = new Ratelimit({
      ...options,
      prefix: "paphos-location-search:client:v1",
      limiter: Ratelimit.slidingWindow(
        LOCATION_SEARCH_RATE_LIMIT_MAX_CLIENT_MISSES,
        "5 m",
      ),
    });
    const clientResult = await client.limit(identifier);
    // Upstash can return success on timeout; that must not allow provider access.
    if (clientResult.reason === "timeout") return "unavailable";
    if (!clientResult.success) return "rate_limited";

    const global = new Ratelimit({
      ...options,
      prefix: "paphos-location-search:provider:v1",
      limiter: Ratelimit.slidingWindow(
        LOCATION_SEARCH_RATE_LIMIT_MAX_PROVIDER_MISSES,
        "5 m",
      ),
    });
    const globalResult = await global.limit(LOCATION_SEARCH_RATE_LIMIT_KEY);
    if (globalResult.reason === "timeout") return "unavailable";
    return globalResult.success ? "allowed" : "rate_limited";
  } catch {
    return "unavailable";
  }
}

function normalizedClientIp(value: string | undefined): string | null {
  if (!value || value.includes("%")) return null;
  const ip = value.trim();
  const family = isIP(ip);
  if (family === 4) return ip;
  if (family !== 6) return null;

  // URL canonicalization collapses IPv6 case/zero spelling variants. Map IPv4
  // mapped IPv6 to IPv4 so the same address cannot receive a second allowance.
  const canonical = new URL(`http://[${ip}]/`).hostname.slice(1, -1);
  const mapped = /^::ffff:([0-9a-f]+):([0-9a-f]+)$/.exec(canonical);
  if (!mapped) return canonical;
  return mapped
    .slice(1)
    .flatMap((part) => {
      const word = Number.parseInt(part, 16);
      return [word >>> 8, word & 255];
    })
    .join(".");
}

export function manualLocationProviderIsConfigured(): boolean {
  return Boolean(process.env.GEOAPIFY_API_KEY?.trim());
}

function isCachedSuggestion(value: unknown): value is ManualLocationSuggestion {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  const suggestion = value as Record<string, unknown>;
  return (
    Object.keys(suggestion).every((key) =>
      ["resultIdentifier", "label", "latitude", "longitude", "resultType"].includes(
        key,
      ),
    ) &&
    typeof suggestion.resultIdentifier === "string" &&
    suggestion.resultIdentifier.length > 0 &&
    typeof suggestion.label === "string" &&
    suggestion.label.length > 0 &&
    typeof suggestion.latitude === "number" &&
    Number.isFinite(suggestion.latitude) &&
    typeof suggestion.longitude === "number" &&
    Number.isFinite(suggestion.longitude) &&
    (suggestion.resultType === null || typeof suggestion.resultType === "string")
  );
}

function cachedSuggestions(value: unknown): ManualLocationSuggestion[] | null {
  if (
    !Array.isArray(value) ||
    value.length > MANUAL_SUGGESTION_LIMIT ||
    !value.every(isCachedSuggestion)
  ) {
    return null;
  }
  return value;
}

function locationSearchCache() {
  return getCache({ namespace: LOCATION_SEARCH_CACHE_NAMESPACE });
}

export async function readCachedManualLocationSuggestions(
  normalizedQuery: string,
): Promise<ManualLocationSuggestion[] | null> {
  try {
    return cachedSuggestions(await locationSearchCache().get(normalizedQuery));
  } catch {
    return null;
  }
}

export async function writeCachedManualLocationSuggestions(
  normalizedQuery: string,
  suggestions: ManualLocationSuggestion[],
): Promise<void> {
  try {
    await locationSearchCache().set(normalizedQuery, suggestions, {
      name: "manual-location-suggestions",
      ttl: LOCATION_SEARCH_CACHE_SECONDS,
    });
  } catch {
    // Cache failure never bypasses the distributed provider budget on a later miss.
  }
}

export async function fetchManualLocationSuggestions(
  normalizedQuery: string,
  requestSignal?: AbortSignal,
) {
  const apiKey = process.env.GEOAPIFY_API_KEY?.trim();
  if (!apiKey) throw new LocationSearchProviderError(503);

  const response = await fetch(
    buildGeoapifySearchUrl(buildManualLocationQuery(normalizedQuery), apiKey, {
      limit: MANUAL_SUGGESTION_LIMIT,
      language: "en",
    }),
    {
      cache: "no-store",
      headers: { accept: "application/json" },
      signal: requestSignal
        ? AbortSignal.any([requestSignal, AbortSignal.timeout(10_000)])
        : AbortSignal.timeout(10_000),
    },
  );

  if (response.status === 429) throw new LocationSearchProviderError(429);
  if (!response.ok) throw new LocationSearchProviderError(502);

  let providerResponse: GeoapifyResponse;
  try {
    providerResponse = (await response.json()) as GeoapifyResponse;
  } catch {
    throw new LocationSearchProviderError(502);
  }

  try {
    return manualLocationSuggestions(
      Array.isArray(providerResponse.results) ? providerResponse.results : [],
    )
      .filter(
        (suggestion) =>
          typeof suggestion.resultIdentifier === "string" &&
          suggestion.resultIdentifier.length > 0 &&
          typeof suggestion.label === "string" &&
          suggestion.label.length > 0 &&
          Number.isFinite(suggestion.latitude) &&
          Number.isFinite(suggestion.longitude),
      )
      .slice(0, MANUAL_SUGGESTION_LIMIT);
  } catch {
    throw new LocationSearchProviderError(502);
  }
}
