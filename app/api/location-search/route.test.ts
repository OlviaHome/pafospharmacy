import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  cacheStore,
  checkRateLimitMock,
  getCacheMock,
  runtimeCacheGetMock,
  runtimeCacheSetMock,
} = vi.hoisted(() => ({
  cacheStore: new Map<string, unknown>(),
  checkRateLimitMock: vi.fn(),
  getCacheMock: vi.fn(),
  runtimeCacheGetMock: vi.fn(),
  runtimeCacheSetMock: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@vercel/firewall", () => ({ checkRateLimit: checkRateLimitMock }));
vi.mock("@vercel/functions", () => ({ getCache: getCacheMock }));

import { MANUAL_SUGGESTION_LIMIT } from "@/lib/location/manual-search";
import {
  LOCATION_SEARCH_MAX_BODY_BYTES,
  LOCATION_SEARCH_RATE_LIMIT_MAX_PROVIDER_MISSES,
  LOCATION_SEARCH_RATE_LIMIT_ID,
  LOCATION_SEARCH_RATE_LIMIT_WINDOW_SECONDS,
} from "@/lib/location/location-search-server";

import * as locationSearchRoute from "./route";

const { POST } = locationSearchRoute;

function request(
  body: BodyInit | null,
  headers: Record<string, string> = { "Content-Type": "application/json" },
): Request {
  const init: RequestInit & { duplex?: "half" } = {
    method: "POST",
    headers,
    body,
  };
  if (body instanceof ReadableStream) init.duplex = "half";
  return new Request("http://localhost/api/location-search", init);
}

function jsonRequest(body: unknown, headers: Record<string, string> = {}): Request {
  return request(JSON.stringify(body), {
    "Content-Type": "application/json",
    ...headers,
  });
}

function providerResults(count = 1) {
  return Array.from({ length: count }, (_, index) => ({
    place_id: `place-${index}`,
    lat: 34.77 + index * 0.001,
    lon: 32.42 + index * 0.001,
    formatted: `Paphos match ${index}`,
    country_code: "cy",
    state: "Paphos District",
    iso3166_2: "CY-05",
    result_type: "city",
  }));
}

beforeEach(() => {
  vi.stubEnv("GEOAPIFY_API_KEY", "test-server-key");
  vi.stubEnv("VERCEL", "");
  cacheStore.clear();
  getCacheMock.mockReset();
  runtimeCacheGetMock.mockReset();
  runtimeCacheSetMock.mockReset();
  runtimeCacheGetMock.mockImplementation(async (key: string) =>
    cacheStore.has(key) ? cacheStore.get(key) : null,
  );
  runtimeCacheSetMock.mockImplementation(async (key: string, value: unknown) => {
    cacheStore.set(key, value);
  });
  getCacheMock.mockReturnValue({
    get: runtimeCacheGetMock,
    set: runtimeCacheSetMock,
  });
  checkRateLimitMock.mockReset();
  checkRateLimitMock.mockResolvedValue({ rateLimited: false });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("manual location route request hardening", () => {
  it("exports only POST as an HTTP method", () => {
    expect(typeof locationSearchRoute.POST).toBe("function");
    for (const method of ["GET", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]) {
      expect(method in locationSearchRoute).toBe(false);
    }
  });

  it("requires an application/json content type", async () => {
    const providerFetch = vi.fn();
    vi.stubGlobal("fetch", providerFetch);

    const response = await POST(
      request(JSON.stringify({ query: "Paphos" }), {
        "Content-Type": "text/plain",
      }),
    );

    expect(response.status).toBe(415);
    expect(providerFetch).not.toHaveBeenCalled();
  });

  it("accepts the standard JSON charset parameter", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(Response.json({ results: providerResults() })),
    );

    const response = await POST(
      request(JSON.stringify({ query: "Paphos" }), {
        "Content-Type": "application/json; charset=utf-8",
      }),
    );

    expect(response.status).toBe(200);
  });

  it("rejects declared bodies larger than one KiB before provider access", async () => {
    const providerFetch = vi.fn();
    vi.stubGlobal("fetch", providerFetch);

    const response = await POST(
      request("{}", {
        "Content-Type": "application/json",
        "Content-Length": String(LOCATION_SEARCH_MAX_BODY_BYTES + 1),
      }),
    );

    expect(response.status).toBe(413);
    expect(providerFetch).not.toHaveBeenCalled();
  });

  it("stops streamed bodies after one KiB", async () => {
    const providerFetch = vi.fn();
    vi.stubGlobal("fetch", providerFetch);
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(700));
        controller.enqueue(new Uint8Array(400));
        controller.close();
      },
    });

    const response = await POST(request(stream));

    expect(response.status).toBe(413);
    expect(providerFetch).not.toHaveBeenCalled();
  });

  it.each([
    ["invalid JSON", "{"],
    ["an array", JSON.stringify(["Paphos"])],
    ["a missing query", JSON.stringify({})],
    ["an extra field", JSON.stringify({ query: "Paphos", extra: true })],
    ["a numeric query", JSON.stringify({ query: 123 })],
    ["a boolean query", JSON.stringify({ query: false })],
    ["a null query", JSON.stringify({ query: null })],
  ])("rejects %s without coercion", async (_label, body) => {
    const providerFetch = vi.fn();
    vi.stubGlobal("fetch", providerFetch);

    const response = await POST(request(body));

    expect(response.status).toBe(400);
    expect(providerFetch).not.toHaveBeenCalled();
  });

  it("preserves normalized query validation from 3 through 120 characters", async () => {
    const providerFetch = vi
      .fn()
      .mockResolvedValue(Response.json({ results: providerResults() }));
    vi.stubGlobal("fetch", providerFetch);

    expect((await POST(jsonRequest({ query: "  ab  " }))).status).toBe(400);
    expect((await POST(jsonRequest({ query: "x".repeat(121) }))).status).toBe(400);
    expect((await POST(jsonRequest({ query: "  ABC  " }))).status).toBe(200);
    expect(providerFetch).toHaveBeenCalledTimes(1);
  });

  it("rejects cross-origin browser requests but allows absent browser metadata", async () => {
    const providerFetch = vi
      .fn()
      .mockResolvedValue(Response.json({ results: providerResults() }));
    vi.stubGlobal("fetch", providerFetch);

    const crossOrigin = await POST(
      jsonRequest(
        { query: "Paphos" },
        { Origin: "https://attacker.example", "Sec-Fetch-Site": "cross-site" },
      ),
    );
    const nullOrigin = await POST(
      jsonRequest({ query: "Paphos" }, { Origin: "null" }),
    );
    const nonBrowser = await POST(jsonRequest({ query: "Paphos" }));

    expect(crossOrigin.status).toBe(403);
    expect(nullOrigin.status).toBe(403);
    expect(nonBrowser.status).toBe(200);
    expect(providerFetch).toHaveBeenCalledTimes(1);
  });

  it("accepts matching same-origin browser metadata", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(Response.json({ results: providerResults() })),
    );

    const response = await POST(
      jsonRequest(
        { query: "Paphos" },
        { Origin: "http://localhost", "Sec-Fetch-Site": "same-origin" },
      ),
    );

    expect(response.status).toBe(200);
  });
});

describe("manual location route provider protections", () => {
  it("keeps missing server configuration generic", async () => {
    vi.stubEnv("GEOAPIFY_API_KEY", "");
    const providerFetch = vi.fn();
    vi.stubGlobal("fetch", providerFetch);

    const response = await POST(jsonRequest({ query: "Paphos" }));

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: "Manual location search is temporarily unavailable.",
    });
    expect(checkRateLimitMock).not.toHaveBeenCalled();
    expect(providerFetch).not.toHaveBeenCalled();
  });

  it("uses the one shared Vercel provider-budget bucket", async () => {
    vi.stubEnv("VERCEL", "1");
    checkRateLimitMock.mockResolvedValue({ rateLimited: true });
    const providerFetch = vi.fn();
    vi.stubGlobal("fetch", providerFetch);

    const response = await POST(jsonRequest({ query: "Paphos" }));

    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe(
      String(LOCATION_SEARCH_RATE_LIMIT_WINDOW_SECONDS),
    );
    expect(LOCATION_SEARCH_RATE_LIMIT_WINDOW_SECONDS).toBe(60);
    expect(LOCATION_SEARCH_RATE_LIMIT_MAX_PROVIDER_MISSES).toBe(2);
    expect(checkRateLimitMock).toHaveBeenCalledWith(
      LOCATION_SEARCH_RATE_LIMIT_ID,
      expect.objectContaining({
        rateLimitKey: "paphos-location-search",
        request: expect.any(Request),
      }),
    );
    expect(providerFetch).not.toHaveBeenCalled();
  });

  it("fails closed when the Vercel Firewall rule is not configured", async () => {
    vi.stubEnv("VERCEL", "1");
    checkRateLimitMock.mockResolvedValue({
      rateLimited: false,
      error: "not-found",
    });
    const providerFetch = vi.fn();
    vi.stubGlobal("fetch", providerFetch);

    const response = await POST(jsonRequest({ query: "Paphos" }));

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: "Manual location search is temporarily unavailable.",
    });
    expect(providerFetch).not.toHaveBeenCalled();
  });

  it("maps provider quota exhaustion to a generic 429 without leaking details", async () => {
    const providerFetch = vi.fn().mockResolvedValue(
      new Response("provider secret diagnostic", { status: 429 }),
    );
    vi.stubGlobal("fetch", providerFetch);

    const response = await POST(jsonRequest({ query: "Paphos" }));
    const responseText = await response.text();

    expect(response.status).toBe(429);
    expect(responseText).toContain("Too many location searches");
    expect(responseText).not.toContain("provider secret diagnostic");
    expect(responseText).not.toContain("test-server-key");
    expect(responseText).not.toContain("api.geoapify.com");
  });

  it("maps other provider failures to a generic 502", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("upstream detail", { status: 500 })),
    );

    const response = await POST(jsonRequest({ query: "Paphos" }));
    const responseText = await response.text();

    expect(response.status).toBe(502);
    expect(responseText).toContain("temporarily unavailable");
    expect(responseText).not.toContain("upstream detail");
  });

  it("shares successful five-minute cache entries by normalized query", async () => {
    vi.stubEnv("VERCEL", "1");
    const providerFetch = vi
      .fn()
      .mockResolvedValue(Response.json({ results: providerResults() }));
    vi.stubGlobal("fetch", providerFetch);

    const first = await POST(jsonRequest({ query: " Pa\u0301phos   Harbour " }));
    const second = await POST(jsonRequest({ query: "PÁPHOS harbour" }));

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(providerFetch).toHaveBeenCalledTimes(1);
    expect(checkRateLimitMock).toHaveBeenCalledTimes(1);
    expect(runtimeCacheGetMock).toHaveBeenCalledTimes(2);
    expect(runtimeCacheSetMock).toHaveBeenCalledTimes(1);
    expect(runtimeCacheSetMock).toHaveBeenCalledWith(
      "páphos harbour",
      expect.any(Array),
      expect.objectContaining({ ttl: 300 }),
    );
    expect(runtimeCacheGetMock.mock.invocationCallOrder[0]).toBeLessThan(
      checkRateLimitMock.mock.invocationCallOrder[0],
    );
    expect(checkRateLimitMock.mock.invocationCallOrder[0]).toBeLessThan(
      providerFetch.mock.invocationCallOrder[0],
    );
  });

  it("serves a shared cache hit before checking the provider budget", async () => {
    vi.stubEnv("VERCEL", "1");
    vi.stubEnv("GEOAPIFY_API_KEY", "");
    const suggestions = [
      {
        resultIdentifier: "cached-place",
        label: "Cached Paphos match",
        latitude: 34.77,
        longitude: 32.42,
        resultType: "city",
      },
    ];
    cacheStore.set("paphos", suggestions);
    const providerFetch = vi.fn();
    vi.stubGlobal("fetch", providerFetch);

    const response = await POST(jsonRequest({ query: "Paphos" }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ suggestions });
    expect(runtimeCacheGetMock).toHaveBeenCalledWith("paphos");
    expect(checkRateLimitMock).not.toHaveBeenCalled();
    expect(providerFetch).not.toHaveBeenCalled();
  });

  it("permits two provider-bound misses in the mocked window and blocks the next", async () => {
    vi.stubEnv("VERCEL", "1");
    checkRateLimitMock
      .mockResolvedValueOnce({ rateLimited: false })
      .mockResolvedValueOnce({ rateLimited: false })
      .mockResolvedValueOnce({ rateLimited: true });
    const providerFetch = vi
      .fn()
      .mockImplementation(async () =>
        Response.json({ results: providerResults() }),
      );
    vi.stubGlobal("fetch", providerFetch);

    const firstMiss = await POST(jsonRequest({ query: "Paphos harbour" }));
    const cacheHit = await POST(jsonRequest({ query: "PAPHOS   HARBOUR" }));
    const secondMiss = await POST(jsonRequest({ query: "Paphos old town" }));
    const blockedMiss = await POST(jsonRequest({ query: "Paphos airport" }));

    expect([firstMiss.status, cacheHit.status, secondMiss.status]).toEqual([
      200, 200, 200,
    ]);
    expect(blockedMiss.status).toBe(429);
    expect(checkRateLimitMock).toHaveBeenCalledTimes(3);
    expect(providerFetch).toHaveBeenCalledTimes(
      LOCATION_SEARCH_RATE_LIMIT_MAX_PROVIDER_MISSES,
    );
  });

  it("does not cache provider failures", async () => {
    const providerFetch = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 500 }))
      .mockResolvedValueOnce(Response.json({ results: providerResults() }));
    vi.stubGlobal("fetch", providerFetch);

    expect((await POST(jsonRequest({ query: "Paphos" }))).status).toBe(502);
    expect((await POST(jsonRequest({ query: "Paphos" }))).status).toBe(200);
    expect(providerFetch).toHaveBeenCalledTimes(2);
  });

  it("requests and returns at most the three suggestions the UI can use", async () => {
    const providerFetch = vi
      .fn()
      .mockResolvedValue(Response.json({ results: providerResults(5) }));
    vi.stubGlobal("fetch", providerFetch);

    const response = await POST(jsonRequest({ query: "Paphos" }));
    const providerUrl = new URL(String(providerFetch.mock.calls[0]?.[0]));
    const body = (await response.json()) as { suggestions: unknown[] };

    expect(response.status).toBe(200);
    expect(providerUrl.searchParams.get("limit")).toBe(
      String(MANUAL_SUGGESTION_LIMIT),
    );
    expect(body.suggestions).toHaveLength(MANUAL_SUGGESTION_LIMIT);
  });
});
