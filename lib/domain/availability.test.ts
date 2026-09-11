import { describe, expect, it } from "vitest";

import {
  deriveAvailability,
  filterPharmaciesByAvailability,
  isIntervalActive,
} from "./availability";
import { getCyprusDayWindow } from "./date";
import type {
  AvailabilityInterval,
  DutyAssignment,
  Pharmacy,
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

function pharmacy(id: string, dutyAssignments: DutyAssignment[] = []): Pharmacy {
  return {
    id,
    name: `Pharmacy ${id}`,
    addressLine: "1 Test Street",
    addressAdditional: null,
    locality: "Paphos",
    district: "Paphos",
    postalCode: "8010",
    latitude: null,
    longitude: null,
    geocodeProvider: null,
    geocodeResultIdentifier: null,
    geocodeQuery: null,
    geocodeQuality: null,
    geocodedAt: null,
    phoneE164: "+35726000000",
    officialRegistrationNumber: id,
    pharmacistGivenName: null,
    pharmacistSurname: null,
    source: "test",
    sourceDataset: null,
    sourceResourceUrl: null,
    sourceRetrievedAt: null,
    intervals: [],
    dutyAssignments,
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

  it("combines a date-only assignment with the applicable official duty rule", () => {
    expect(
      deriveAvailability([], instant, {
        dutyAssignments: [dateOnlyDuty],
        ordinaryOpeningCoverageKnown: false,
      }),
    ).toMatchObject({
      openNow: true,
      onDuty: true,
      onCall: false,
      activeDutyAssignments: [dateOnlyDuty],
    });
  });

  it("allows a trustworthy ordinary/open interval to prove Open Now independently", () => {
    expect(
      deriveAvailability([interval("ordinary", "ordinary", "open")], instant, {
        dutyAssignments: [dateOnlyDuty],
        ordinaryOpeningCoverageKnown: false,
      }),
    ).toMatchObject({ openNow: true, onDuty: true, onCall: false });
  });

  it("derives overnight on-call from the previous local date assignment", () => {
    expect(
      deriveAvailability([], new Date("2026-08-31T21:30:00.000Z"), {
        dutyAssignments: [dateOnlyDuty],
        ordinaryOpeningCoverageKnown: false,
      }),
    ).toMatchObject({
      openNow: "unknown",
      onDuty: true,
      onCall: true,
      activeDutyAssignments: [dateOnlyDuty],
    });
  });

  it("does not label a scheduled duty gap as open", () => {
    expect(
      deriveAvailability([], new Date("2026-08-31T14:00:00.000Z"), {
        dutyAssignments: [dateOnlyDuty],
        ordinaryOpeningCoverageKnown: false,
      }),
    ).toMatchObject({ openNow: "unknown", onDuty: true, onCall: false });
  });

  it("uses the official regular schedule as an independent open fact", () => {
    expect(
      deriveAvailability([], new Date("2026-08-31T07:00:00.000Z"), {
        ordinaryOpeningCoverageKnown: false,
        applyOfficialRegularSchedule: true,
      }),
    ).toMatchObject({ openNow: true, onDuty: false, onCall: false });
    expect(
      deriveAvailability([], new Date("2026-08-31T11:30:00.000Z"), {
        ordinaryOpeningCoverageKnown: false,
        applyOfficialRegularSchedule: true,
      }),
    ).toMatchObject({ openNow: false, onDuty: false, onCall: false });
  });

  it("keeps overnight duty on-call physically closed when regular hours are closed", () => {
    expect(
      deriveAvailability([], new Date("2026-08-31T22:00:00.000Z"), {
        dutyAssignments: [dateOnlyDuty],
        ordinaryOpeningCoverageKnown: false,
        applyOfficialRegularSchedule: true,
      }),
    ).toMatchObject({ openNow: false, onDuty: true, onCall: true });
  });

  it("uses duty opening as the holiday exception to regular closure", () => {
    const holidayDuty = {
      ...dateOnlyDuty,
      id: "holiday-duty",
      dutyDate: "2026-06-01",
    };
    const holidayInstant = new Date("2026-06-01T09:00:00.000Z");

    expect(
      deriveAvailability([], holidayInstant, {
        ordinaryOpeningCoverageKnown: false,
        applyOfficialRegularSchedule: true,
      }).openNow,
    ).toBe(false);
    expect(
      deriveAvailability([], holidayInstant, {
        dutyAssignments: [holidayDuty],
        ordinaryOpeningCoverageKnown: false,
        applyOfficialRegularSchedule: true,
      }).openNow,
    ).toBe(true);
  });

  it("keeps unsupported years unknown", () => {
    expect(
      deriveAvailability([], new Date("2027-06-07T08:00:00.000Z"), {
        ordinaryOpeningCoverageKnown: false,
        applyOfficialRegularSchedule: true,
      }).openNow,
    ).toBe("unknown");
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

describe("Open Now filter", () => {
  it("returns the union of regular-open and duty-open pharmacies", () => {
    const duty = {
      ...dateOnlyDuty,
      id: "monday-duty",
      dutyDate: "2026-08-31",
    };
    const ordinary = pharmacy("ordinary");
    const assigned = pharmacy("duty", [duty]);

    const morning = new Date("2026-08-31T07:00:00.000Z");
    expect(
      filterPharmaciesByAvailability(
        [ordinary, assigned],
        "open_now",
        getCyprusDayWindow(morning),
        morning,
        false,
        true,
      ).map((item) => item.id),
    ).toEqual(["ordinary", "duty"]);

    const breakTime = new Date("2026-08-31T11:30:00.000Z");
    expect(
      filterPharmaciesByAvailability(
        [ordinary, assigned],
        "open_now",
        getCyprusDayWindow(breakTime),
        breakTime,
        false,
        true,
      ).map((item) => item.id),
    ).toEqual(["duty"]);
  });

  it("uses the regular-and-duty union at every summer Monday boundary", () => {
    const assigned = pharmacy("duty", [dateOnlyDuty]);
    const ordinary = pharmacy("ordinary");
    const cases = [
      { instant: "2026-08-31T04:59:00.000Z", ordinary: false, duty: false },
      { instant: "2026-08-31T05:00:00.000Z", ordinary: true, duty: true },
      { instant: "2026-08-31T10:29:00.000Z", ordinary: true, duty: true },
      { instant: "2026-08-31T10:30:00.000Z", ordinary: false, duty: true },
      { instant: "2026-08-31T12:59:00.000Z", ordinary: false, duty: true },
      { instant: "2026-08-31T13:00:00.000Z", ordinary: true, duty: true },
      { instant: "2026-08-31T16:29:00.000Z", ordinary: true, duty: true },
      { instant: "2026-08-31T16:30:00.000Z", ordinary: false, duty: true },
      { instant: "2026-08-31T19:59:00.000Z", ordinary: false, duty: true },
      { instant: "2026-08-31T20:00:00.000Z", ordinary: false, duty: false },
    ];

    for (const testCase of cases) {
      const at = new Date(testCase.instant);
      const window = getCyprusDayWindow(at);
      expect(
        filterPharmaciesByAvailability(
          [ordinary],
          "open_now",
          window,
          at,
          false,
          true,
        ),
        `ordinary at ${testCase.instant}`,
      ).toHaveLength(testCase.ordinary ? 1 : 0);
      expect(
        filterPharmaciesByAvailability(
          [assigned],
          "open_now",
          window,
          at,
          false,
          true,
        ),
        `duty at ${testCase.instant}`,
      ).toHaveLength(testCase.duty ? 1 : 0);
    }

    expect(
      deriveAvailability([], new Date("2026-08-31T20:00:00.000Z"), {
        dutyAssignments: [dateOnlyDuty],
        ordinaryOpeningCoverageKnown: false,
        applyOfficialRegularSchedule: true,
      }),
    ).toMatchObject({ openNow: false, onCall: true });
  });

  it("excludes a previous-day overnight on-call pharmacy", () => {
    const overnight = new Date("2026-08-31T22:00:00.000Z");
    expect(
      filterPharmaciesByAvailability(
        [pharmacy("duty", [dateOnlyDuty])],
        "open_now",
        getCyprusDayWindow(overnight),
        overnight,
        false,
        true,
      ),
    ).toEqual([]);
  });
});
