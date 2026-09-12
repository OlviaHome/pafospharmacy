import type { Pharmacy } from "./types";

export const NEAREST_INITIAL_RESULT_LIMIT = 10;

export interface PharmacyResult {
  pharmacy: Pharmacy;
  distanceKm: number | null;
}

export function sortPharmacyResults(
  results: PharmacyResult[],
  fallbackComparison: (left: PharmacyResult, right: PharmacyResult) => number = () => 0,
): PharmacyResult[] {
  return [...results].sort((left, right) => {
    if (left.distanceKm !== null && right.distanceKm !== null) {
      return left.distanceKm - right.distanceKm || fallbackComparison(left, right);
    }
    if (left.distanceKm !== null) return -1;
    if (right.distanceKm !== null) return 1;
    return fallbackComparison(left, right);
  });
}

export function formatDistance(distanceKm: number, locale = "en-GB"): string {
  if (distanceKm < 1) {
    return new Intl.NumberFormat(locale, {
      style: "unit",
      unit: "meter",
      unitDisplay: "short",
      maximumFractionDigits: 0,
    }).format(distanceKm * 1_000);
  }
  return new Intl.NumberFormat(locale, {
    style: "unit",
    unit: "kilometer",
    unitDisplay: "short",
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(distanceKm);
}

export function visiblePharmacyResults(
  results: PharmacyResult[],
  options: {
    filter: "all" | "open_now" | "on_duty";
    locationKnown: boolean;
    expanded: boolean;
  },
): PharmacyResult[] {
  if (options.filter !== "all" || !options.locationKnown || options.expanded) {
    return results;
  }
  return results.slice(0, NEAREST_INITIAL_RESULT_LIMIT);
}
