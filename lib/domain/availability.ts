import type {
  AvailabilityInterval,
  DayWindow,
  DerivedAvailability,
  DutyAssignment,
  Pharmacy,
} from "./types";

import { getCyprusDayWindow } from "./date";

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
  dutyAssignments: DutyAssignment[] = [],
): boolean {
  return (
    intervalsForWindow(intervals, window).some(
      (interval) => interval.scheduleKind === "duty",
    ) || dutyAssignments.some((assignment) => assignment.dutyDate === window.localDate)
  );
}

export interface AvailabilityDerivationOptions {
  dutyAssignments?: DutyAssignment[];
  ordinaryOpeningCoverageKnown?: boolean;
}

export function deriveAvailability(
  intervals: AvailabilityInterval[],
  instant: Date,
  options: AvailabilityDerivationOptions = {},
): DerivedAvailability {
  const dutyAssignments = options.dutyAssignments ?? [];
  const ordinaryOpeningCoverageKnown = options.ordinaryOpeningCoverageKnown ?? true;
  const localDate = getCyprusDayWindow(instant).localDate;
  const activeIntervals = intervals.filter((interval) => isIntervalActive(interval, instant));
  const activeDutyAssignments = dutyAssignments.filter(
    (assignment) => assignment.dutyDate === localDate,
  );
  const ordinary = activeIntervals.filter((interval) => interval.scheduleKind === "ordinary");
  const duty = activeIntervals.filter((interval) => interval.scheduleKind === "duty");
  const hasOpenFact = activeIntervals.some((interval) => interval.serviceMode === "open");
  const hasUnknownDuty = duty.some((interval) => interval.serviceMode === "unknown");
  const hasOnCallDuty = duty.some((interval) => interval.serviceMode === "on_call");
  const dutyModes = new Set(duty.map((interval) => interval.serviceMode));

  return {
    openNow:
      hasOpenFact
        ? true
        : hasUnknownDuty || activeDutyAssignments.length > 0 || !ordinaryOpeningCoverageKnown
          ? "unknown"
          : false,
    onDuty: duty.length > 0 || activeDutyAssignments.length > 0,
    onCall:
      duty.length === 0
        ? activeDutyAssignments.length > 0
          ? "unknown"
          : false
        : duty.length > 1 || hasUnknownDuty
          ? "unknown"
          : hasOnCallDuty,
    hasConflict:
      ordinary.length > 1 ||
      duty.length > 1 ||
      dutyModes.size > 1 ||
      (ordinary.some((interval) => interval.serviceMode === "open") && hasOnCallDuty),
    activeIntervals,
    activeDutyAssignments,
  };
}

export function filterPharmaciesByAvailability(
  pharmacies: Pharmacy[],
  filter: AvailabilityFilter,
  window: DayWindow,
  instant: Date,
  ordinaryOpeningCoverageKnown = true,
): Pharmacy[] {
  if (filter === "open_now") {
    return pharmacies.filter(
      (pharmacy) =>
        deriveAvailability(pharmacy.intervals, instant, {
          dutyAssignments: pharmacy.dutyAssignments,
          ordinaryOpeningCoverageKnown,
        }).openNow === true,
    );
  }

  if (filter === "on_duty") {
    return pharmacies.filter((pharmacy) =>
      hasDutyInWindow(pharmacy.intervals, window, pharmacy.dutyAssignments),
    );
  }

  return pharmacies;
}
