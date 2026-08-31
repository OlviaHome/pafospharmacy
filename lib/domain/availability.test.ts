import { describe, expect, it } from "vitest";

import { deriveAvailability, isIntervalActive } from "./availability";
import type { AvailabilityInterval, ScheduleKind, ServiceMode } from "./types";

const instant = new Date("2026-08-31T12:00:00.000Z");

function interval(
  id: string,
  scheduleKind: ScheduleKind,
  serviceMode: ServiceMode,
  startsAt = "2026-08-31T11:00:00.000Z",
  endsAt = "2026-08-31T13:00:00.000Z",
): AvailabilityInterval {
  return {
    id,
    pharmacyId: "pharmacy-1",
    startsAt,
    endsAt,
    scheduleKind,
    serviceMode,
  };
}

describe("isIntervalActive", () => {
  const ordinary = interval("ordinary", "ordinary", "open");

  it("includes the start boundary", () => {
    expect(isIntervalActive(ordinary, new Date(ordinary.startsAt))).toBe(true);
  });

  it("excludes the end boundary", () => {
    expect(isIntervalActive(ordinary, new Date(ordinary.endsAt))).toBe(false);
  });
});

describe("deriveAvailability", () => {
  it("derives ordinary/open without inventing duty", () => {
    expect(deriveAvailability([interval("ordinary", "ordinary", "open")], instant)).toMatchObject({
      openNow: true,
      onDuty: false,
      onCall: false,
      hasConflict: false,
    });
  });

  it("derives duty/open", () => {
    expect(deriveAvailability([interval("duty-open", "duty", "open")], instant)).toMatchObject({
      openNow: true,
      onDuty: true,
      onCall: false,
    });
  });

  it("derives duty/on_call", () => {
    expect(deriveAvailability([interval("duty-call", "duty", "on_call")], instant)).toMatchObject({
      openNow: false,
      onDuty: true,
      onCall: true,
    });
  });

  it("keeps duty/unknown unresolved", () => {
    expect(deriveAvailability([interval("duty-unknown", "duty", "unknown")], instant)).toMatchObject({
      openNow: "unknown",
      onDuty: true,
      onCall: "unknown",
    });
  });

  it("combines an allowed ordinary/open and duty/open overlap", () => {
    expect(
      deriveAvailability(
        [
          interval("ordinary", "ordinary", "open"),
          interval("duty", "duty", "open"),
        ],
        instant,
      ),
    ).toMatchObject({ openNow: true, onDuty: true, onCall: false, hasConflict: false });
  });

  it("flags ordinary/open plus duty/on_call without choosing precedence", () => {
    expect(
      deriveAvailability(
        [
          interval("ordinary", "ordinary", "open"),
          interval("duty", "duty", "on_call"),
        ],
        instant,
      ),
    ).toMatchObject({ openNow: true, onDuty: true, onCall: true, hasConflict: true });
  });

  it("returns no active state for an elapsed interval", () => {
    expect(
      deriveAvailability(
        [
          interval(
            "elapsed",
            "ordinary",
            "open",
            "2026-08-31T09:00:00.000Z",
            instant.toISOString(),
          ),
        ],
        instant,
      ),
    ).toMatchObject({ openNow: false, onDuty: false, onCall: false, activeIntervals: [] });
  });
});
