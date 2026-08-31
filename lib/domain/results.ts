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

export function formatDistance(distanceKm: number): string {
  if (distanceKm < 1) return `${Math.round(distanceKm * 1_000)} m`;
  return `${distanceKm.toFixed(1)} km`;
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
