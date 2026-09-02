import { afterEach, describe, expect, it, vi } from "vitest";

import { MANUAL_SUGGESTION_LIMIT } from "@/lib/location/manual-search";

import { POST } from "./route";

const originalApiKey = process.env.GEOAPIFY_API_KEY;

afterEach(() => {
  if (originalApiKey === undefined) delete process.env.GEOAPIFY_API_KEY;
  else process.env.GEOAPIFY_API_KEY = originalApiKey;
  vi.unstubAllGlobals();
});

function request(query: string): Request {
  return new Request("http://localhost/api/location-search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });
}

describe("manual location route request budget", () => {
  it("rejects fewer than three normalized characters before provider access", async () => {
    const providerFetch = vi.fn();
    vi.stubGlobal("fetch", providerFetch);

    const response = await POST(request("  ab  "));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "Enter between 3 and 120 characters.",
    });
    expect(providerFetch).not.toHaveBeenCalled();
  });

  it("requests and returns at most the three suggestions the UI can use", async () => {
    process.env.GEOAPIFY_API_KEY = "test-server-key";
    const providerResults = Array.from({ length: 5 }, (_, index) => ({
      place_id: `place-${index}`,
      lat: 34.77 + index * 0.001,
      lon: 32.42 + index * 0.001,
      formatted: `Paphos match ${index}`,
      country_code: "cy",
      state: "Paphos District",
      iso3166_2: "CY-05",
      result_type: "city",
    }));
    const providerFetch = vi.fn().mockResolvedValue(
      Response.json({ results: providerResults }),
    );
    vi.stubGlobal("fetch", providerFetch);

    const response = await POST(request("Paphos"));
    const providerUrl = new URL(String(providerFetch.mock.calls[0]?.[0]));
    const body = (await response.json()) as { suggestions: unknown[] };

    expect(response.status).toBe(200);
    expect(providerUrl.searchParams.get("limit")).toBe(
      String(MANUAL_SUGGESTION_LIMIT),
    );
    expect(body.suggestions).toHaveLength(MANUAL_SUGGESTION_LIMIT);
  });
});
