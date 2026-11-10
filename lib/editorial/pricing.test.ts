import { describe, expect, it } from "vitest";

import { estimateCostUsd, reservedCostUsd } from "./pricing";

describe("estimateCostUsd", () => {
  it("prices uncached input, cached input, output and searches", () => {
    expect(
      estimateCostUsd("gpt-5.6-terra", {
        inputTokens: 1_000_000,
        cachedInputTokens: 500_000,
        outputTokens: 100_000,
        webSearchCalls: 3,
      }),
    ).toBeCloseTo(0.5 * 2 + 0.5 * 0.2 + 0.1 * 12 + 0.03, 6);
  });

  it("uses the strictest price for unknown models", () => {
    const usage = { inputTokens: 1_000_000, cachedInputTokens: 0, outputTokens: 0, webSearchCalls: 0 };
    expect(estimateCostUsd("some-new-model", usage)).toBeGreaterThan(estimateCostUsd("gpt-5.6-sol", usage));
  });

  it("reserves a realistic amount per article", () => {
    const write = reservedCostUsd("gpt-5.6-terra", "write");
    expect(write).toBeGreaterThan(0.2);
    expect(write).toBeLessThan(1);
    expect(reservedCostUsd("gpt-5.6-terra", "translate")).toBeLessThan(write);
  });
});
