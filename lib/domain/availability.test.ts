import { describe, expect, it } from "vitest";

import { deriveAvailability, isIntervalActive } from "./availability";
import type {
  AvailabilityInterval,
  DutyAssignment,
  ScheduleKind,
  ServiceMode,
} from "./types";

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

const dateOnlyDuty: DutyAssignment = {
  id: "assignment-1",
  pharmacyId: "pharmacy-1",
  dutyDate: "2026-08-31",
  sourceDataset: "Official rota",
  sourceRecordIdentifier: "duty:2026-08-31:1",
  sourceResourceUrl: "https://example.test/rota.csv",
  sourceRetrievedAt: "2026-08-01T00:00:00.000Z",
};

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

  it("derives only On Duty from a date-only duty assignment", () => {
    expect(
      deriveAvailability([], instant, {
        dutyAssignments: [dateOnlyDuty],
        ordinaryOpeningCoverageKnown: false,
      }),
    ).toMatchObject({
      openNow: "unknown",
      onDuty: true,
      onCall: "unknown",
      activeDutyAssignments: [dateOnlyDuty],
    });
  });

  it("allows a trustworthy ordinary/open interval to prove Open Now independently", () => {
    expect(
      deriveAvailability([interval("ordinary", "ordinary", "open")], instant, {
        dutyAssignments: [dateOnlyDuty],
        ordinaryOpeningCoverageKnown: false,
      }),
    ).toMatchObject({ openNow: true, onDuty: true, onCall: "unknown" });
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
