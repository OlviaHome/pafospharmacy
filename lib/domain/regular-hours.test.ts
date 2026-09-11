import { describe, expect, it } from "vitest";

import {
  CYPRUS_REGULAR_HOLIDAYS_2026,
  deriveOfficialRegularStatus,
  officialRegularScheduleForDate,
} from "./regular-hours";

describe("officialRegularScheduleForDate", () => {
  it("uses the split summer weekday schedule", () => {
    expect(officialRegularScheduleForDate("2026-08-31")?.openPeriods).toEqual([
      {
        startsAt: "2026-08-31T05:00:00.000Z",
        endsAt: "2026-08-31T10:30:00.000Z",
      },
      {
        startsAt: "2026-08-31T13:00:00.000Z",
        endsAt: "2026-08-31T16:30:00.000Z",
      },
    ]);
  });

  it("uses the split winter weekday schedule", () => {
    expect(officialRegularScheduleForDate("2026-01-12")?.openPeriods).toEqual([
      {
        startsAt: "2026-01-12T06:00:00.000Z",
        endsAt: "2026-01-12T11:30:00.000Z",
      },
      {
        startsAt: "2026-01-12T13:00:00.000Z",
        endsAt: "2026-01-12T16:30:00.000Z",
      },
    ]);
  });

  it("uses morning-only hours on Wednesday and Saturday", () => {
    for (const localDate of ["2026-09-02", "2026-09-05"]) {
      expect(officialRegularScheduleForDate(localDate)?.openPeriods).toEqual([
        {
          startsAt: `${localDate}T05:00:00.000Z`,
          endsAt: `${localDate}T10:30:00.000Z`,
        },
      ]);
    }
  });

  it("closes on Sunday", () => {
    expect(officialRegularScheduleForDate("2026-09-06")).toMatchObject({
      openPeriods: [],
      closedAllDayReason: "sunday",
    });
  });

  it("uses exactly the versioned 2026 pharmacy-holiday calendar", () => {
    expect(Object.entries(CYPRUS_REGULAR_HOLIDAYS_2026)).toEqual([
      ["2026-01-01", "New Year's Day"],
      ["2026-01-06", "Epiphany"],
      ["2026-02-23", "Clean Monday"],
      ["2026-03-25", "Greek Independence Day"],
      ["2026-04-01", "Cyprus National Day"],
      ["2026-04-11", "Holy Saturday"],
      ["2026-04-13", "Easter Monday"],
      ["2026-04-14", "Easter Tuesday"],
      ["2026-05-01", "May Day"],
      ["2026-06-01", "Holy Spirit Monday"],
      ["2026-08-15", "Assumption Day"],
      ["2026-10-01", "Cyprus Independence Day"],
      ["2026-10-28", "Ohi Day"],
      ["2026-12-25", "Christmas Day"],
      ["2026-12-26", "Boxing Day"],
    ]);
    expect(officialRegularScheduleForDate("2026-04-14")).toMatchObject({
      openPeriods: [],
      closedAllDayReason: "public_holiday",
      holidayName: "Easter Tuesday",
    });
  });

  it("returns unsupported instead of guessing another year's movable holidays", () => {
    expect(officialRegularScheduleForDate("2025-12-31")).toBeNull();
    expect(officialRegularScheduleForDate("2027-01-01")).toBeNull();
    expect(deriveOfficialRegularStatus(new Date("2027-06-07T08:00:00.000Z"))).toMatchObject({
      mode: "unknown",
      closureReason: "unsupported",
      ruleId: null,
    });
  });
});

describe("deriveOfficialRegularStatus", () => {
  it("uses half-open boundaries throughout a summer Monday", () => {
    expect(deriveOfficialRegularStatus(new Date("2026-08-31T04:59:00.000Z"))).toMatchObject({
      mode: "closed",
      closureReason: "before_open",
      nextOpenAt: "2026-08-31T05:00:00.000Z",
    });
    expect(deriveOfficialRegularStatus(new Date("2026-08-31T05:00:00.000Z")).mode).toBe("open");
    expect(deriveOfficialRegularStatus(new Date("2026-08-31T10:29:00.000Z")).mode).toBe("open");
    expect(deriveOfficialRegularStatus(new Date("2026-08-31T10:30:00.000Z"))).toMatchObject({
      mode: "closed",
      closureReason: "afternoon_break",
      nextOpenAt: "2026-08-31T13:00:00.000Z",
    });
    expect(deriveOfficialRegularStatus(new Date("2026-08-31T13:00:00.000Z")).mode).toBe("open");
    expect(deriveOfficialRegularStatus(new Date("2026-08-31T16:29:00.000Z")).mode).toBe("open");
    expect(deriveOfficialRegularStatus(new Date("2026-08-31T16:30:00.000Z"))).toMatchObject({
      mode: "closed",
      closureReason: "regular_hours_ended",
    });
  });

  it("reopens at 15:00 and closes at 18:30 in winter", () => {
    expect(deriveOfficialRegularStatus(new Date("2026-01-12T12:59:59.000Z"))).toMatchObject({
      mode: "closed",
      closureReason: "afternoon_break",
      nextOpenAt: "2026-01-12T13:00:00.000Z",
    });
    expect(deriveOfficialRegularStatus(new Date("2026-01-12T13:00:00.000Z")).mode).toBe("open");
    expect(deriveOfficialRegularStatus(new Date("2026-01-12T16:30:00.000Z"))).toMatchObject({
      mode: "closed",
      closureReason: "regular_hours_ended",
    });
  });

  it("uses half-open Wednesday and Saturday morning boundaries", () => {
    for (const localDate of ["2026-09-02", "2026-09-05"]) {
      expect(
        deriveOfficialRegularStatus(new Date(`${localDate}T04:59:00.000Z`)),
      ).toMatchObject({ mode: "closed", closureReason: "before_open" });
      expect(
        deriveOfficialRegularStatus(new Date(`${localDate}T05:00:00.000Z`)).mode,
      ).toBe("open");
      expect(
        deriveOfficialRegularStatus(new Date(`${localDate}T10:29:00.000Z`)).mode,
      ).toBe("open");
      expect(
        deriveOfficialRegularStatus(new Date(`${localDate}T10:30:00.000Z`)),
      ).toMatchObject({
        mode: "closed",
        closureReason: "regular_hours_ended",
      });
    }
  });

  it("closes regular pharmacies on Sunday and pharmacy holidays", () => {
    expect(deriveOfficialRegularStatus(new Date("2026-09-06T09:00:00.000Z"))).toMatchObject({
      mode: "closed",
      closureReason: "sunday",
    });
    expect(deriveOfficialRegularStatus(new Date("2026-06-01T09:00:00.000Z"))).toMatchObject({
      mode: "closed",
      closureReason: "public_holiday",
      holidayName: "Holy Spirit Monday",
    });
  });

  it("constructs Europe/Nicosia instants correctly across the DST transition", () => {
    expect(officialRegularScheduleForDate("2026-03-27")?.openPeriods[0]?.startsAt).toBe(
      "2026-03-27T06:00:00.000Z",
    );
    expect(officialRegularScheduleForDate("2026-03-30")?.openPeriods[0]?.startsAt).toBe(
      "2026-03-30T05:00:00.000Z",
    );
  });
});
