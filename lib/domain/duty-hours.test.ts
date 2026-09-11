import { describe, expect, it } from "vitest";

import type { DutyAssignment } from "./types";
import {
  deriveOfficialDutyStatus,
  officialDutyRuleAppliesAtInstant,
  officialDutyScheduleForDate,
} from "./duty-hours";

function assignment(dutyDate: string): DutyAssignment {
  return {
    id: `duty-${dutyDate}`,
    pharmacyId: "pharmacy-1",
    dutyDate,
    sourceDataset: "official-2026-duty",
    sourceRecordIdentifier: `official:${dutyDate}:1`,
    sourceResourceUrl: "https://example.test/duty.csv",
    sourceRetrievedAt: "2026-08-01T00:00:00.000Z",
  };
}

describe("officialDutyScheduleForDate", () => {
  it("uses split Monday, Tuesday, Thursday, and Friday duty hours", () => {
    const schedule = officialDutyScheduleForDate("2026-08-31");

    expect(schedule?.openPeriods).toEqual([
      {
        serviceMode: "open",
        startsAt: "2026-08-31T10:30:00.000Z",
        endsAt: "2026-08-31T13:00:00.000Z",
      },
      {
        serviceMode: "open",
        startsAt: "2026-08-31T16:30:00.000Z",
        endsAt: "2026-08-31T20:00:00.000Z",
      },
    ]);
  });

  it("uses continuous Wednesday and Saturday duty hours", () => {
    expect(officialDutyScheduleForDate("2026-09-02")?.openPeriods).toEqual([
      {
        serviceMode: "open",
        startsAt: "2026-09-02T10:30:00.000Z",
        endsAt: "2026-09-02T20:00:00.000Z",
      },
    ]);
    expect(officialDutyScheduleForDate("2026-09-05")?.openPeriods).toHaveLength(1);
  });

  it("uses 08:00–23:00 on Sunday and every holiday named by the notice", () => {
    expect(officialDutyScheduleForDate("2026-09-06")?.openPeriods[0]).toEqual({
      serviceMode: "open",
      startsAt: "2026-09-06T05:00:00.000Z",
      endsAt: "2026-09-06T20:00:00.000Z",
    });
    for (const holiday of ["2026-05-01", "2026-06-01", "2026-08-15"]) {
      expect(officialDutyScheduleForDate(holiday)?.openPeriods).toHaveLength(1);
      expect(
        officialDutyScheduleForDate(holiday)?.openPeriods[0],
      ).toMatchObject({ serviceMode: "open" });
    }
  });

  it("does not apply the rule outside its assignment-date coverage", () => {
    expect(officialDutyScheduleForDate("2026-04-30")).toBeNull();
    expect(officialDutyScheduleForDate("2026-10-01")).toBeNull();
  });
});

describe("deriveOfficialDutyStatus", () => {
  it("uses half-open boundaries for the split weekday periods", () => {
    const assignments = [assignment("2026-08-31")];

    expect(
      deriveOfficialDutyStatus(assignments, new Date("2026-08-31T10:29:59.000Z")).mode,
    ).toBe("scheduled_gap");
    expect(
      deriveOfficialDutyStatus(assignments, new Date("2026-08-31T10:30:00.000Z")).mode,
    ).toBe("open");
    expect(
      deriveOfficialDutyStatus(assignments, new Date("2026-08-31T13:00:00.000Z")),
    ).toMatchObject({ mode: "scheduled_gap", nextOpenAt: "2026-08-31T16:30:00.000Z" });
    expect(
      deriveOfficialDutyStatus(assignments, new Date("2026-08-31T16:30:00.000Z")).mode,
    ).toBe("open");
  });

  it("carries the assignment through overnight on-call until 08:00 Cyprus time", () => {
    const assignments = [assignment("2026-08-31")];

    expect(
      deriveOfficialDutyStatus(assignments, new Date("2026-08-31T20:00:00.000Z")),
    ).toMatchObject({
      mode: "on_call",
      onDutyToday: true,
      assignment: assignments[0],
      activePeriod: {
        startsAt: "2026-08-31T20:00:00.000Z",
        endsAt: "2026-09-01T05:00:00.000Z",
      },
    });
    expect(
      deriveOfficialDutyStatus(assignments, new Date("2026-09-01T04:59:59.000Z")).mode,
    ).toBe("on_call");
    expect(
      deriveOfficialDutyStatus(assignments, new Date("2026-09-01T05:00:00.000Z")).mode,
    ).toBe("inactive");
  });

  it("lets a 30 September assignment carry into 1 October without extending the rule", () => {
    const assignments = [assignment("2026-09-30")];

    expect(
      deriveOfficialDutyStatus(assignments, new Date("2026-09-30T21:30:00.000Z")).mode,
    ).toBe("on_call");
    expect(officialDutyRuleAppliesAtInstant(new Date("2026-09-30T21:30:00.000Z"))).toBe(
      true,
    );
    expect(officialDutyRuleAppliesAtInstant(new Date("2026-10-01T05:00:00.000Z"))).toBe(
      false,
    );
  });

  it("keeps an unsupported date-only assignment unknown", () => {
    expect(
      deriveOfficialDutyStatus(
        [assignment("2026-10-01")],
        new Date("2026-10-01T12:00:00.000Z"),
      ),
    ).toMatchObject({ mode: "unknown", onDutyToday: true, ruleId: null });
  });
});
