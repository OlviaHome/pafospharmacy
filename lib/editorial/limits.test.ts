import { describe, expect, it } from "vitest";

import { cyprusDayStart, cyprusMonthStart, evaluateLimits } from "./limits";

const limits = { dailyArticles: 5, dailyJobs: 40, monthlyBudgetUsd: 10, parallelJobs: 3 };
const idle = { activeJobs: 0, jobsToday: 0, articlesToday: 0, spentThisMonthUsd: 0 };

describe("evaluateLimits", () => {
  it("allows work within every limit", () => {
    expect(evaluateLimits("write", idle, limits, 0.5)).toEqual({ ok: true });
  });

  it("blocks when the reservation would exceed the monthly budget", () => {
    const result = evaluateLimits("translate", { ...idle, spentThisMonthUsd: 9.8 }, limits, 0.3);
    expect(result.ok).toBe(false);
  });

  it("blocks too many parallel jobs", () => {
    expect(evaluateLimits("edit", { ...idle, activeJobs: 3 }, limits, 0.1).ok).toBe(false);
  });

  it("blocks after the daily job limit", () => {
    expect(evaluateLimits("edit", { ...idle, jobsToday: 40 }, limits, 0.1).ok).toBe(false);
  });

  it("applies the daily article limit only to new articles", () => {
    const busy = { ...idle, articlesToday: 5 };
    expect(evaluateLimits("write", busy, limits, 0.5).ok).toBe(false);
    expect(evaluateLimits("edit", busy, limits, 0.1).ok).toBe(true);
  });

  it("blocks everything when the budget is zero", () => {
    expect(evaluateLimits("translate", idle, { ...limits, monthlyBudgetUsd: 0 }, 0.01).ok).toBe(false);
  });
});

describe("Cyprus calendar boundaries", () => {
  it("starts the day at Cyprus midnight", () => {
    // 2026-11-10 23:30 UTC is already 11 November in Cyprus (UTC+2).
    expect(cyprusDayStart(new Date("2026-11-10T23:30:00Z"))).toBe("2026-11-10T22:00:00.000Z");
  });

  it("starts the month on the 1st at Cyprus midnight", () => {
    expect(cyprusMonthStart(new Date("2026-11-10T12:00:00Z"))).toBe("2026-10-31T22:00:00.000Z");
    // Summer time (UTC+3).
    expect(cyprusMonthStart(new Date("2026-07-15T12:00:00Z"))).toBe("2026-06-30T21:00:00.000Z");
  });
});
