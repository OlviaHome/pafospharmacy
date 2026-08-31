import type {
  AvailabilityInterval,
  DayWindow,
  DerivedAvailability,
  Pharmacy,
} from "./types";

export type AvailabilityFilter = "all" | "open_now" | "on_duty";

export function isIntervalActive(interval: AvailabilityInterval, instant: Date): boolean {
  const timestamp = instant.getTime();
  return (
    new Date(interval.startsAt).getTime() <= timestamp &&
    timestamp < new Date(interval.endsAt).getTime()
  );
}

export function intervalOverlapsWindow(
  interval: AvailabilityInterval,
  window: DayWindow,
): boolean {
  return (
    new Date(interval.startsAt).getTime() < new Date(window.end).getTime() &&
    new Date(interval.endsAt).getTime() > new Date(window.start).getTime()
  );
}

export function intervalsForWindow(
  intervals: AvailabilityInterval[],
  window: DayWindow,
): AvailabilityInterval[] {
  return intervals
    .filter((interval) => intervalOverlapsWindow(interval, window))
    .sort((left, right) => left.startsAt.localeCompare(right.startsAt));
}

export function hasDutyInWindow(
  intervals: AvailabilityInterval[],
  window: DayWindow,
): boolean {
  return intervalsForWindow(intervals, window).some(
    (interval) => interval.scheduleKind === "duty",
  );
}

export function deriveAvailability(
  intervals: AvailabilityInterval[],
  instant: Date,
): DerivedAvailability {
  const activeIntervals = intervals.filter((interval) => isIntervalActive(interval, instant));
  const ordinary = activeIntervals.filter((interval) => interval.scheduleKind === "ordinary");
  const duty = activeIntervals.filter((interval) => interval.scheduleKind === "duty");
  const hasOpenFact = activeIntervals.some((interval) => interval.serviceMode === "open");
  const hasUnknownDuty = duty.some((interval) => interval.serviceMode === "unknown");
  const hasOnCallDuty = duty.some((interval) => interval.serviceMode === "on_call");
  const dutyModes = new Set(duty.map((interval) => interval.serviceMode));

  return {
    openNow: hasOpenFact ? true : hasUnknownDuty ? "unknown" : false,
    onDuty: duty.length > 0,
    onCall:
      duty.length === 0
        ? false
        : duty.length > 1 || hasUnknownDuty
          ? "unknown"
          : hasOnCallDuty,
    hasConflict:
      ordinary.length > 1 ||
      duty.length > 1 ||
      dutyModes.size > 1 ||
      (ordinary.some((interval) => interval.serviceMode === "open") && hasOnCallDuty),
    activeIntervals,
  };
}

export function filterPharmaciesByAvailability(
  pharmacies: Pharmacy[],
  filter: AvailabilityFilter,
  window: DayWindow,
  instant: Date,
): Pharmacy[] {
  if (filter === "open_now") {
    return pharmacies.filter(
      (pharmacy) => deriveAvailability(pharmacy.intervals, instant).openNow === true,
    );
  }

  if (filter === "on_duty") {
    return pharmacies.filter((pharmacy) => hasDutyInWindow(pharmacy.intervals, window));
  }

  return pharmacies;
}
