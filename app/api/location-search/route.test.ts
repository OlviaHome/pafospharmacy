import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  ipAddressMock,
  shortTermLimitMock,
  dailyLimitMock,
  ratelimitOptions,
  cacheStore,
  clientLimitMock,
  getCacheMock,
  runtimeCacheGetMock,
  runtimeCacheSetMock,
} = vi.hoisted(() => ({
  ipAddressMock: vi.fn(),
  shortTermLimitMock: vi.fn(),
  dailyLimitMock: vi.fn(),
  ratelimitOptions: [] as Array<Record<string, unknown>>,
  cacheStore: new Map<string, unknown>(),
  clientLimitMock: vi.fn(),
  getCacheMock: vi.fn(),
  runtimeCacheGetMock: vi.fn(),
  runtimeCacheSetMock: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@upstash/redis", () => ({ Redis: class {} }));
vi.mock("@upstash/ratelimit", () => ({
  Ratelimit: class {
    static slidingWindow(tokens: number, window: string) {
      return { tokens, window };
    }
    limit: typeof clientLimitMock;
    constructor(options: Record<string, unknown>) {
      ratelimitOptions.push(options);
      const prefix = String(options.prefix);
      this.limit = prefix.includes(":client:")
        ? clientLimitMock
        : prefix.includes(":provider-short:")
          ? shortTermLimitMock
          : dailyLimitMock;
    }
  },
}));
vi.mock("@vercel/functions", () => ({
  getCache: getCacheMock,
  ipAddress: ipAddressMock,
}));

import { MANUAL_SUGGESTION_LIMIT } from "@/lib/location/manual-search";
import {
  LOCATION_SEARCH_MAX_BODY_BYTES,
  LOCATION_SEARCH_RATE_LIMIT_MAX_DAILY_PROVIDER_MISSES,
  LOCATION_SEARCH_RATE_LIMIT_MAX_SHORT_TERM_PROVIDER_MISSES,
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
  vi.stubEnv("VERCEL", "1");
  vi.stubEnv("UPSTASH_REDIS_REST_URL", "https://test.upstash.io");
  vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "test-redis-token");
  vi.stubEnv("LOCATION_SEARCH_HMAC_SECRET", "test-secret-with-at-least-32-bytes");
  ipAddressMock.mockReset();
  ipAddressMock.mockReturnValue("192.0.2.1");
  ratelimitOptions.length = 0;
  shortTermLimitMock.mockReset();
  shortTermLimitMock.mockResolvedValue({ success: true });
  dailyLimitMock.mockReset();
  dailyLimitMock.mockResolvedValue({ success: true });
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
  clientLimitMock.mockReset();
  clientLimitMock.mockResolvedValue({ success: true });
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
    expect(clientLimitMock).not.toHaveBeenCalled();
    expect(providerFetch).not.toHaveBeenCalled();
  });

  it("returns the five-minute 429 when the client's allowance is exhausted", async () => {
    clientLimitMock.mockResolvedValue({ success: false });
    const providerFetch = vi.fn();
    vi.stubGlobal("fetch", providerFetch);
    const response = await POST(jsonRequest({ query: "Paphos" }));
    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({
      error: "Too many location searches. Please try again in 5 minutes.",
      code: "client_rate_limited",
    });
    expect(response.headers.get("Retry-After")).toBe("300");
    expect(LOCATION_SEARCH_RATE_LIMIT_WINDOW_SECONDS).toBe(300);
    expect(shortTermLimitMock).not.toHaveBeenCalled();
    expect(dailyLimitMock).not.toHaveBeenCalled();
    expect(providerFetch).not.toHaveBeenCalled();
  });

  it.each(["client", "short-term global", "daily global"])(
    "fails closed on %s Redis errors and fail-open timeouts",
    async (stage) => {
      const limiter =
        stage === "client"
          ? clientLimitMock
          : stage === "short-term global"
            ? shortTermLimitMock
            : dailyLimitMock;
      const providerFetch = vi.fn();
      vi.stubGlobal("fetch", providerFetch);
      for (const timeout of [false, true]) {
        if (timeout) {
          limiter.mockResolvedValue({ success: true, reason: "timeout" });
        } else {
          limiter.mockRejectedValue(new Error("private Redis diagnostic"));
        }
        const response = await POST(jsonRequest({ query: "Paphos" }));
        expect(response.status).toBe(503);
        expect(await response.json()).toEqual({
          error: "Manual location search is temporarily unavailable.",
        });
      }
      expect(providerFetch).not.toHaveBeenCalled();
      if (stage === "client") {
        expect(shortTermLimitMock).not.toHaveBeenCalled();
        expect(dailyLimitMock).not.toHaveBeenCalled();
      }
      if (stage === "short-term global") {
        expect(dailyLimitMock).not.toHaveBeenCalled();
      }
    },
  );

  it("maps provider quota exhaustion to a generic 429 without leaking details", async () => {
    const providerFetch = vi.fn().mockResolvedValue(
      new Response("provider secret diagnostic", { status: 429 }),
    );
    vi.stubGlobal("fetch", providerFetch);

    const response = await POST(jsonRequest({ query: "Paphos" }));
    const responseText = await response.text();

    expect(response.status).toBe(429);
    expect(responseText).toContain("temporarily unavailable");
    expect(response.headers.get("Retry-After")).toBeNull();
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
    expect(clientLimitMock).toHaveBeenCalledTimes(1);
    expect(shortTermLimitMock).toHaveBeenCalledTimes(1);
    expect(dailyLimitMock).toHaveBeenCalledTimes(1);
    expect(runtimeCacheGetMock).toHaveBeenCalledTimes(2);
    expect(runtimeCacheSetMock).toHaveBeenCalledTimes(1);
    expect(runtimeCacheSetMock).toHaveBeenCalledWith(
      "páphos harbour",
      expect.any(Array),
      expect.objectContaining({ ttl: 300 }),
    );
    expect(runtimeCacheGetMock.mock.invocationCallOrder[0]).toBeLessThan(
      clientLimitMock.mock.invocationCallOrder[0],
    );
    expect(clientLimitMock.mock.invocationCallOrder[0]).toBeLessThan(
      shortTermLimitMock.mock.invocationCallOrder[0],
    );
    expect(shortTermLimitMock.mock.invocationCallOrder[0]).toBeLessThan(
      dailyLimitMock.mock.invocationCallOrder[0],
    );
    expect(dailyLimitMock.mock.invocationCallOrder[0]).toBeLessThan(
      providerFetch.mock.invocationCallOrder[0],
    );
  });

  it("serves a shared cache hit before checking the provider budget", async () => {
    vi.stubEnv("VERCEL", "1");
    vi.stubEnv("GEOAPIFY_API_KEY", "");
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "");
    ipAddressMock.mockReturnValue(undefined);
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
    expect(ipAddressMock).not.toHaveBeenCalled();
    expect(shortTermLimitMock).not.toHaveBeenCalled();
    expect(dailyLimitMock).not.toHaveBeenCalled();
    expect(clientLimitMock).not.toHaveBeenCalled();
    expect(providerFetch).not.toHaveBeenCalled();
  });

  it("limits one client to five misses while another client can still search", async () => {
    const counts = new Map<string, number>();
    clientLimitMock.mockImplementation(async (id: string) => {
      const count = (counts.get(id) ?? 0) + 1;
      counts.set(id, count);
      return { success: count <= 5 };
    });
    const providerFetch = vi
      .fn()
      .mockImplementation(async () => Response.json({ results: providerResults() }));
    vi.stubGlobal("fetch", providerFetch);
    for (let i = 0; i < 5; i++) {
      expect(
        (await POST(jsonRequest({ query: `Paphos street ${i}` }))).status,
      ).toBe(200);
    }
    expect(
      (await POST(jsonRequest({ query: "Paphos sixth street" }))).status,
    ).toBe(429);
    expect(shortTermLimitMock).toHaveBeenCalledTimes(5);
    expect(dailyLimitMock).toHaveBeenCalledTimes(5);
    expect((await POST(jsonRequest({ query: "PAPHOS STREET 0" }))).status).toBe(
      200,
    );
    expect(clientLimitMock).toHaveBeenCalledTimes(6);
    ipAddressMock.mockReturnValue("192.0.2.2");
    expect(
      (await POST(jsonRequest({ query: "Paphos other street" }))).status,
    ).toBe(200);
    expect(shortTermLimitMock).toHaveBeenCalledTimes(6);
    expect(dailyLimitMock).toHaveBeenCalledTimes(6);
    expect(providerFetch).toHaveBeenCalledTimes(6);
    expect(counts.size).toBe(2);
    for (const id of counts.keys()) expect(id).toMatch(/^[a-f0-9]{64}$/);
    expect(ratelimitOptions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          prefix: "paphos-location-search:client:v1",
          limiter: { tokens: 5, window: "5 m" },
          analytics: false,
          ephemeralCache: false,
        }),
        expect.objectContaining({
          prefix: "paphos-location-search:provider-short:v1",
          limiter: { tokens: 20, window: "1 m" },
          analytics: false,
          ephemeralCache: false,
        }),
        expect.objectContaining({
          prefix: "paphos-location-search:provider-daily:v1",
          limiter: { tokens: 2_500, window: "24 h" },
          analytics: false,
          ephemeralCache: false,
        }),
      ]),
    );
  });

  it("enforces the 20-miss one-minute global budget across clients", async () => {
    shortTermLimitMock.mockImplementation(async () => ({
      success: shortTermLimitMock.mock.calls.length <= 20,
    }));
    const providerFetch = vi
      .fn()
      .mockImplementation(async () => Response.json({ results: providerResults() }));
    vi.stubGlobal("fetch", providerFetch);
    for (let i = 0; i < 21; i++) {
      ipAddressMock.mockReturnValue(`192.0.2.${i + 1}`);
      const response = await POST(jsonRequest({ query: `Paphos street ${i}` }));
      expect(response.status).toBe(i < 20 ? 200 : 429);
    }
    expect(providerFetch).toHaveBeenCalledTimes(
      LOCATION_SEARCH_RATE_LIMIT_MAX_SHORT_TERM_PROVIDER_MISSES,
    );
    expect(dailyLimitMock).toHaveBeenCalledTimes(20);
    expect(new Set(shortTermLimitMock.mock.calls.map(([key]) => key))).toEqual(
      new Set(["paphos-location-search"]),
    );
  });

  it("enforces the 2,500-miss daily provider budget after the short-term budget", async () => {
    dailyLimitMock.mockResolvedValue({ success: false });
    const providerFetch = vi.fn();
    vi.stubGlobal("fetch", providerFetch);

    const response = await POST(jsonRequest({ query: "Paphos daily budget" }));

    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({
      error: "Location search is temporarily unavailable. Try again later.",
    });
    expect(response.headers.get("Retry-After")).toBeNull();
    expect(shortTermLimitMock).toHaveBeenCalledTimes(1);
    expect(dailyLimitMock).toHaveBeenCalledTimes(1);
    expect(providerFetch).not.toHaveBeenCalled();
    expect(LOCATION_SEARCH_RATE_LIMIT_MAX_DAILY_PROVIDER_MISSES).toBe(2_500);
    expect(shortTermLimitMock.mock.invocationCallOrder[0]).toBeLessThan(
      dailyLimitMock.mock.invocationCallOrder[0],
    );
  });

  it.each([undefined, "", "invalid", "192.0.2.1, 192.0.2.2", "fe80::1%eth0"])(
    "fails closed for unavailable or invalid platform IP %s despite forwarding headers",
    async (ip) => {
      ipAddressMock.mockReturnValue(ip);
      const providerFetch = vi.fn();
      vi.stubGlobal("fetch", providerFetch);
      const response = await POST(
        jsonRequest(
          { query: "Paphos" },
          {
            "X-Forwarded-For": "192.0.2.55",
            Forwarded: "for=192.0.2.55",
            "X-Real-IP": "192.0.2.55",
          },
        ),
      );
      expect(response.status).toBe(503);
      expect(clientLimitMock).not.toHaveBeenCalled();
      expect(shortTermLimitMock).not.toHaveBeenCalled();
      expect(dailyLimitMock).not.toHaveBeenCalled();
      expect(providerFetch).not.toHaveBeenCalled();
    },
  );

  it("ignores spoofed forwarding headers and never returns the client identifier", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async () =>
        Response.json({ results: providerResults() }),
      ),
    );
    for (let i = 0; i < 2; i++) {
      const response = await POST(
        jsonRequest(
          { query: `Paphos street ${i}` },
          { "X-Forwarded-For": `192.0.2.${i + 10}` },
        ),
      );
      const text = await response.text();
      expect(text).not.toContain("192.0.2.1");
      expect(text).not.toContain(clientLimitMock.mock.calls[i][0]);
    }
    expect(clientLimitMock.mock.calls[0][0]).toBe(clientLimitMock.mock.calls[1][0]);
  });

  it.each([
    ["2001:0DB8:0000:0000:0000:0000:0000:0001", "2001:db8::1"],
    ["::ffff:192.0.2.1", "192.0.2.1"],
  ])("normalizes equivalent IP spellings before HMAC: %s", async (first, second) => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async () =>
        Response.json({ results: providerResults() }),
      ),
    );
    ipAddressMock.mockReturnValueOnce(first).mockReturnValueOnce(second);
    await POST(jsonRequest({ query: "Paphos first street" }));
    await POST(jsonRequest({ query: "Paphos second street" }));
    expect(clientLimitMock).toHaveBeenCalledTimes(2);
    expect(clientLimitMock.mock.calls[0][0]).toBe(
      clientLimitMock.mock.calls[1][0],
    );
  });

  it.each([
    "UPSTASH_REDIS_REST_URL",
    "UPSTASH_REDIS_REST_TOKEN",
    "LOCATION_SEARCH_HMAC_SECRET",
    "VERCEL",
  ])("fails closed when %s is absent", async (name) => {
    vi.stubEnv(name, "");
    const providerFetch = vi.fn();
    vi.stubGlobal("fetch", providerFetch);
    expect((await POST(jsonRequest({ query: "Paphos" }))).status).toBe(503);
    expect(clientLimitMock).not.toHaveBeenCalled();
    expect(providerFetch).not.toHaveBeenCalled();
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
