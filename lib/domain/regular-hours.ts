import { getCyprusDayWindow, localDateTimeToInstant } from "./date";

export const CYPRUS_REGULAR_RULE_ID = "cyprus-regular-pharmacy-hours-2026";
export const CYPRUS_REGULAR_RULE_SOURCE_URL =
  "https://www.mof.gov.cy/mof/gpo/gazette.nsf/B8F7312559CEBBDBC2258856001F84D8/%24file/5706%203%206%202022%20PARARTIMA%203o%20MEROS%20I.pdf";
export const CYPRUS_REGULAR_RULE_START_DATE = "2026-01-01";
export const CYPRUS_REGULAR_RULE_END_DATE = "2026-12-31";

export const CYPRUS_REGULAR_HOLIDAYS_2026 = {
  "2026-01-01": "New Year's Day",
  "2026-01-06": "Epiphany",
  "2026-02-23": "Clean Monday",
  "2026-03-25": "Greek Independence Day",
  "2026-04-01": "Cyprus National Day",
  "2026-04-11": "Holy Saturday",
  "2026-04-13": "Easter Monday",
  "2026-04-14": "Easter Tuesday",
  "2026-05-01": "May Day",
  "2026-06-01": "Holy Spirit Monday",
  "2026-08-15": "Assumption Day",
  "2026-10-01": "Cyprus Independence Day",
  "2026-10-28": "Ohi Day",
  "2026-12-25": "Christmas Day",
  "2026-12-26": "Boxing Day",
} as const;

export type OfficialRegularSeason = "summer" | "winter";
export type OfficialRegularServiceMode = "open" | "closed" | "unknown";
export type OfficialRegularClosureReason =
  | "before_open"
  | "afternoon_break"
  | "regular_hours_ended"
  | "sunday"
  | "public_holiday"
  | "unsupported";

export interface OfficialRegularPeriod {
  startsAt: string;
  endsAt: string;
}

export interface OfficialRegularSchedule {
  localDate: string;
  ruleId: typeof CYPRUS_REGULAR_RULE_ID;
  sourceUrl: typeof CYPRUS_REGULAR_RULE_SOURCE_URL;
  season: OfficialRegularSeason;
  openPeriods: OfficialRegularPeriod[];
  holidayName: string | null;
  closedAllDayReason: "sunday" | "public_holiday" | null;
}

export interface OfficialRegularStatus {
  mode: OfficialRegularServiceMode;
  activePeriod: OfficialRegularPeriod | null;
  nextOpenAt: string | null;
  closureReason: OfficialRegularClosureReason | null;
  holidayName: string | null;
  ruleId: typeof CYPRUS_REGULAR_RULE_ID | null;
}

interface LocalDateParts {
  year: number;
  month: number;
  day: number;
}

interface ClockTime {
  hour: number;
  minute: number;
}

function parseLocalDate(localDate: string): LocalDateParts {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(localDate);
  if (!match) throw new Error(`Invalid local date: ${localDate}`);

  return {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
  };
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
  localDate: string,
  start: ClockTime,
  end: ClockTime,
): OfficialRegularPeriod {
  return {
    startsAt: instantFor(localDate, start),
    endsAt: instantFor(localDate, end),
  };
}

function isSummer(localDate: string): boolean {
  const monthAndDay = localDate.slice(5);
  return monthAndDay >= "05-01" && monthAndDay <= "09-30";
}

function isActive(value: OfficialRegularPeriod, instant: Date): boolean {
  const timestamp = instant.getTime();
  return (
    new Date(value.startsAt).getTime() <= timestamp &&
    timestamp < new Date(value.endsAt).getTime()
  );
}

export function officialRegularRuleSupportsDate(localDate: string): boolean {
  return (
    localDate >= CYPRUS_REGULAR_RULE_START_DATE &&
    localDate <= CYPRUS_REGULAR_RULE_END_DATE
  );
}

export function officialRegularScheduleForDate(
  localDate: string,
): OfficialRegularSchedule | null {
  if (!officialRegularRuleSupportsDate(localDate)) return null;

  const season: OfficialRegularSeason = isSummer(localDate) ? "summer" : "winter";
  const holidayName =
    CYPRUS_REGULAR_HOLIDAYS_2026[
      localDate as keyof typeof CYPRUS_REGULAR_HOLIDAYS_2026
    ] ?? null;
  const isSunday = weekdayFor(localDate) === 0;
  const closedAllDayReason = holidayName
    ? "public_holiday"
    : isSunday
      ? "sunday"
      : null;

  let openPeriods: OfficialRegularPeriod[] = [];
  if (!closedAllDayReason) {
    const weekday = weekdayFor(localDate);
    if (weekday === 3 || weekday === 6) {
      openPeriods = [
        period(localDate, { hour: 8, minute: 0 }, { hour: 13, minute: 30 }),
      ];
    } else {
      openPeriods = [
        period(localDate, { hour: 8, minute: 0 }, { hour: 13, minute: 30 }),
        period(
          localDate,
          season === "summer"
            ? { hour: 16, minute: 0 }
            : { hour: 15, minute: 0 },
          season === "summer"
            ? { hour: 19, minute: 30 }
            : { hour: 18, minute: 30 },
        ),
      ];
    }
  }

  return {
    localDate,
    ruleId: CYPRUS_REGULAR_RULE_ID,
    sourceUrl: CYPRUS_REGULAR_RULE_SOURCE_URL,
    season,
    openPeriods,
    holidayName,
    closedAllDayReason,
  };
}

export function deriveOfficialRegularStatus(
  instant: Date,
): OfficialRegularStatus {
  const localDate = getCyprusDayWindow(instant).localDate;
  const schedule = officialRegularScheduleForDate(localDate);

  if (!schedule) {
    return {
      mode: "unknown",
      activePeriod: null,
      nextOpenAt: null,
      closureReason: "unsupported",
      holidayName: null,
      ruleId: null,
    };
  }

  const activePeriod = schedule.openPeriods.find((item) => isActive(item, instant));
  if (activePeriod) {
    return {
      mode: "open",
      activePeriod,
      nextOpenAt: null,
      closureReason: null,
      holidayName: null,
      ruleId: CYPRUS_REGULAR_RULE_ID,
    };
  }

  if (schedule.closedAllDayReason) {
    return {
      mode: "closed",
      activePeriod: null,
      nextOpenAt: null,
      closureReason: schedule.closedAllDayReason,
      holidayName: schedule.holidayName,
      ruleId: CYPRUS_REGULAR_RULE_ID,
    };
  }

  const nextOpenAt =
    schedule.openPeriods.find(
      (item) => new Date(item.startsAt).getTime() > instant.getTime(),
    )?.startsAt ?? null;
  const firstStart = schedule.openPeriods[0]?.startsAt;

  return {
    mode: "closed",
    activePeriod: null,
    nextOpenAt,
    closureReason:
      firstStart && instant.getTime() < new Date(firstStart).getTime()
        ? "before_open"
        : nextOpenAt
          ? "afternoon_break"
          : "regular_hours_ended",
    holidayName: null,
    ruleId: CYPRUS_REGULAR_RULE_ID,
  };
}
