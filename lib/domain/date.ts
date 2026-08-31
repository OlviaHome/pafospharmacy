import type { DayWindow } from "./types";

export const CYPRUS_TIME_ZONE = "Europe/Nicosia";

interface LocalDateParts {
  year: number;
  month: number;
  day: number;
}

interface LocalDateTimeParts extends LocalDateParts {
  hour: number;
  minute: number;
  second: number;
}

const partsFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: CYPRUS_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

function readParts(date: Date): LocalDateTimeParts {
  const values = Object.fromEntries(
    partsFormatter
      .formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)]),
  );

  return {
    year: values.year,
    month: values.month,
    day: values.day,
    hour: values.hour,
    minute: values.minute,
    second: values.second,
  };
}

function addLocalDays(date: LocalDateParts, days: number): LocalDateParts {
  const shifted = new Date(Date.UTC(date.year, date.month - 1, date.day + days));
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  };
}

export function localDateTimeToInstant(
  local: LocalDateParts & Partial<Pick<LocalDateTimeParts, "hour" | "minute" | "second">>,
): Date {
  const target = Date.UTC(
    local.year,
    local.month - 1,
    local.day,
    local.hour ?? 0,
    local.minute ?? 0,
    local.second ?? 0,
  );
  let guess = target;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const actual = readParts(new Date(guess));
    const representedAsUtc = Date.UTC(
      actual.year,
      actual.month - 1,
      actual.day,
      actual.hour,
      actual.minute,
      actual.second,
    );
    const correction = target - representedAsUtc;
    guess += correction;
    if (correction === 0) break;
  }

  return new Date(guess);
}

export function getCyprusDayWindow(reference: Date, dayOffset = 0): DayWindow {
  const current = readParts(reference);
  const localDate = addLocalDays(current, dayOffset);
  const nextDate = addLocalDays(localDate, 1);

  return {
    start: localDateTimeToInstant(localDate).toISOString(),
    end: localDateTimeToInstant(nextDate).toISOString(),
    localDate: `${localDate.year}-${String(localDate.month).padStart(2, "0")}-${String(localDate.day).padStart(2, "0")}`,
  };
}

export function formatCyprusTime(instant: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: CYPRUS_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(instant));
}

export function formatCyprusDate(instant: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: CYPRUS_TIME_ZONE,
    weekday: "short",
    day: "numeric",
    month: "short",
  }).format(new Date(instant));
}
