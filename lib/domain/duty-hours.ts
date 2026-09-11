import { getCyprusDayWindow, localDateTimeToInstant } from "./date";
import type { DutyAssignment } from "./types";

export const CYPRUS_DUTY_RULE_ID = "cyprus-duty-2026-may-september";
export const CYPRUS_DUTY_RULE_SOURCE_URL =
  "https://www.moh.gov.cy/MOH/phs/phs.nsf/All/091BC51661367EE1C225857B002F972D";
export const CYPRUS_DUTY_RULE_START_DATE = "2026-05-01";
export const CYPRUS_DUTY_RULE_END_DATE = "2026-09-30";

const NOTICE_HOLIDAYS = new Set([
  "2026-05-01",
  "2026-06-01",
  "2026-08-15",
]);

export type OfficialDutyServiceMode =
  | "open"
  | "on_call"
  | "scheduled_gap"
  | "inactive"
  | "unknown";

export interface OfficialDutyPeriod {
  serviceMode: "open" | "on_call";
  startsAt: string;
  endsAt: string;
}

export interface OfficialDutySchedule {
  assignmentDate: string;
  ruleId: typeof CYPRUS_DUTY_RULE_ID;
  sourceUrl: typeof CYPRUS_DUTY_RULE_SOURCE_URL;
  openPeriods: OfficialDutyPeriod[];
  onCallPeriod: OfficialDutyPeriod;
}

export interface OfficialDutyStatus {
  mode: OfficialDutyServiceMode;
  onDutyToday: boolean;
  assignment: DutyAssignment | null;
  activePeriod: OfficialDutyPeriod | null;
  nextOpenAt: string | null;
  ruleId: typeof CYPRUS_DUTY_RULE_ID | null;
}

interface ClockTime {
  hour: number;
  minute: number;
}

function parseLocalDate(localDate: string): {
  year: number;
  month: number;
  day: number;
} {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(localDate);
  if (!match) throw new Error(`Invalid local date: ${localDate}`);
  return {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
  };
}

export function shiftLocalDate(localDate: string, days: number): string {
  const value = parseLocalDate(localDate);
  const shifted = new Date(Date.UTC(value.year, value.month - 1, value.day + days));
  return [
    shifted.getUTCFullYear(),
    String(shifted.getUTCMonth() + 1).padStart(2, "0"),
    String(shifted.getUTCDate()).padStart(2, "0"),
  ].join("-");
}

function instantFor(localDate: string, time: ClockTime): string {
  return localDateTimeToInstant({
    ...parseLocalDate(localDate),
    hour: time.hour,
    minute: time.minute,
  }).toISOString();
}

function weekdayFor(localDate: string): number {
  const value = parseLocalDate(localDate);
  return new Date(Date.UTC(value.year, value.month - 1, value.day)).getUTCDay();
}

function period(
  assignmentDate: string,
  serviceMode: OfficialDutyPeriod["serviceMode"],
  start: ClockTime,
  end: ClockTime,
  endDayOffset = 0,
): OfficialDutyPeriod {
  return {
    serviceMode,
    startsAt: instantFor(assignmentDate, start),
    endsAt: instantFor(shiftLocalDate(assignmentDate, endDayOffset), end),
  };
}

export function officialDutyRuleSupportsAssignmentDate(
  assignmentDate: string,
): boolean {
  return (
    assignmentDate >= CYPRUS_DUTY_RULE_START_DATE &&
    assignmentDate <= CYPRUS_DUTY_RULE_END_DATE
  );
}

export function officialDutyScheduleForDate(
  assignmentDate: string,
): OfficialDutySchedule | null {
  if (!officialDutyRuleSupportsAssignmentDate(assignmentDate)) return null;

  const weekday = weekdayFor(assignmentDate);
  const isSundayOrNoticeHoliday =
    weekday === 0 || NOTICE_HOLIDAYS.has(assignmentDate);
  const openPeriods = isSundayOrNoticeHoliday
    ? [period(assignmentDate, "open", { hour: 8, minute: 0 }, { hour: 23, minute: 0 })]
    : weekday === 3 || weekday === 6
      ? [
          period(
            assignmentDate,
            "open",
            { hour: 13, minute: 30 },
            { hour: 23, minute: 0 },
          ),
        ]
      : [
          period(
            assignmentDate,
            "open",
            { hour: 13, minute: 30 },
            { hour: 16, minute: 0 },
          ),
          period(
            assignmentDate,
            "open",
            { hour: 19, minute: 30 },
            { hour: 23, minute: 0 },
          ),
        ];

  return {
    assignmentDate,
    ruleId: CYPRUS_DUTY_RULE_ID,
    sourceUrl: CYPRUS_DUTY_RULE_SOURCE_URL,
    openPeriods,
    onCallPeriod: period(
      assignmentDate,
      "on_call",
      { hour: 23, minute: 0 },
      { hour: 8, minute: 0 },
      1,
    ),
  };
}

function isActive(periodValue: OfficialDutyPeriod, instant: Date): boolean {
  const timestamp = instant.getTime();
  return (
    new Date(periodValue.startsAt).getTime() <= timestamp &&
    timestamp < new Date(periodValue.endsAt).getTime()
  );
}

function firstAssignmentForDate(
  assignments: DutyAssignment[],
  localDate: string,
): DutyAssignment | null {
  return assignments.find((assignment) => assignment.dutyDate === localDate) ?? null;
}

export function deriveOfficialDutyStatus(
  assignments: DutyAssignment[],
  instant: Date,
): OfficialDutyStatus {
  const today = getCyprusDayWindow(instant).localDate;
  const previousDate = shiftLocalDate(today, -1);
  const todayAssignment = firstAssignmentForDate(assignments, today);
  const previousAssignment = firstAssignmentForDate(assignments, previousDate);
  const todaySchedule = todayAssignment
    ? officialDutyScheduleForDate(todayAssignment.dutyDate)
    : null;
  const previousSchedule = previousAssignment
    ? officialDutyScheduleForDate(previousAssignment.dutyDate)
    : null;

  const activeOpenPeriod = todaySchedule?.openPeriods.find((item) =>
    isActive(item, instant),
  );
  if (activeOpenPeriod && todayAssignment) {
    return {
      mode: "open",
      onDutyToday: true,
      assignment: todayAssignment,
      activePeriod: activeOpenPeriod,
      nextOpenAt: null,
      ruleId: CYPRUS_DUTY_RULE_ID,
    };
  }

  if (
    todaySchedule &&
    todayAssignment &&
    isActive(todaySchedule.onCallPeriod, instant)
  ) {
    return {
      mode: "on_call",
      onDutyToday: true,
      assignment: todayAssignment,
      activePeriod: todaySchedule.onCallPeriod,
      nextOpenAt: null,
      ruleId: CYPRUS_DUTY_RULE_ID,
    };
  }

  if (
    previousSchedule &&
    previousAssignment &&
    isActive(previousSchedule.onCallPeriod, instant)
  ) {
    return {
      mode: "on_call",
      onDutyToday: todayAssignment !== null,
      assignment: previousAssignment,
      activePeriod: previousSchedule.onCallPeriod,
      nextOpenAt:
        todaySchedule?.openPeriods.find(
          (item) => new Date(item.startsAt).getTime() > instant.getTime(),
        )?.startsAt ?? null,
      ruleId: CYPRUS_DUTY_RULE_ID,
    };
  }

  if (todayAssignment && todaySchedule) {
    return {
      mode: "scheduled_gap",
      onDutyToday: true,
      assignment: todayAssignment,
      activePeriod: null,
      nextOpenAt:
        todaySchedule.openPeriods.find(
          (item) => new Date(item.startsAt).getTime() > instant.getTime(),
        )?.startsAt ?? null,
      ruleId: CYPRUS_DUTY_RULE_ID,
    };
  }

  if (todayAssignment) {
    return {
      mode: "unknown",
      onDutyToday: true,
      assignment: todayAssignment,
      activePeriod: null,
      nextOpenAt: null,
      ruleId: null,
    };
  }

  return {
    mode: "inactive",
    onDutyToday: false,
    assignment: null,
    activePeriod: null,
    nextOpenAt: null,
    ruleId: null,
  };
}

export function officialDutyRuleAppliesAtInstant(instant: Date): boolean {
  const today = getCyprusDayWindow(instant).localDate;
  return (
    officialDutyRuleSupportsAssignmentDate(today) ||
    (officialDutyRuleSupportsAssignmentDate(shiftLocalDate(today, -1)) &&
      instant.getTime() < new Date(instantFor(today, { hour: 8, minute: 0 })).getTime())
  );
}
