import { afterEach, describe, expect, it, vi } from "vitest";

import {
  MANUAL_SEARCH_DEBOUNCE_MILLISECONDS,
  MANUAL_SUGGESTION_LIMIT,
  MINIMUM_MANUAL_QUERY_CHARACTERS,
  SessionManualLocationLookup,
  isManualSearchCancellation,
  normalizeManualLocationQuery,
} from "./manual-search";

afterEach(() => {
  vi.useRealTimers();
});

describe("manual location request budget", () => {
  it("uses the accepted minimum, debounce, and suggestion limit", () => {
    expect(MINIMUM_MANUAL_QUERY_CHARACTERS).toBe(3);
    expect(MANUAL_SEARCH_DEBOUNCE_MILLISECONDS).toBe(400);
    expect(MANUAL_SUGGESTION_LIMIT).toBe(3);
  });

  it("normalizes repeated queries for session caching", () => {
    expect(normalizeManualLocationQuery("  CHLORAKA   Paphos  ")).toBe(
      "chloraka paphos",
    );
    expect(normalizeManualLocationQuery("Chloraka Paphos")).toBe(
      "chloraka paphos",
    );
  });

  it("waits for the debounce before making one request", async () => {
    vi.useFakeTimers();
    const lookup = new SessionManualLocationLookup<string[]>();
    const request = vi.fn().mockResolvedValue(["Chloraka"]);
    const result = lookup.lookup("Chloraka", request);

    await vi.advanceTimersByTimeAsync(399);
    expect(request).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await expect(result).resolves.toEqual(["Chloraka"]);
    expect(request).toHaveBeenCalledOnce();
  });

  it("cancels stale work when a newer query replaces it", async () => {
    vi.useFakeTimers();
    const lookup = new SessionManualLocationLookup<string[]>();
    let firstWasAborted = false;
    const first = lookup
      .lookup("Chloraka", async (signal) => {
        return await new Promise<string[]>((_resolve, reject) => {
          signal.addEventListener("abort", () => {
            firstWasAborted = true;
            const error = new Error("aborted");
            error.name = "AbortError";
            reject(error);
          });
        });
      })
      .catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(400);

    const second = lookup.lookup("Coral Bay", async () => ["Coral Bay"]);
    expect(firstWasAborted).toBe(true);
    await vi.advanceTimersByTimeAsync(400);

    expect(isManualSearchCancellation(await first)).toBe(true);
    await expect(second).resolves.toEqual(["Coral Bay"]);
  });

  it("reuses an identical normalized query without spending another request", async () => {
    vi.useFakeTimers();
    const lookup = new SessionManualLocationLookup<string[]>();
    const request = vi.fn().mockResolvedValue(["Chloraka"]);
    const first = lookup.lookup("Chloraka", request);
    await vi.advanceTimersByTimeAsync(400);
    await expect(first).resolves.toEqual(["Chloraka"]);

    await expect(lookup.lookup("  CHLORAKA ", request)).resolves.toEqual([
      "Chloraka",
    ]);
    expect(request).toHaveBeenCalledOnce();
  });
});
