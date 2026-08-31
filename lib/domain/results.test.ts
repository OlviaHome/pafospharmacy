import { describe, expect, it } from "vitest";

import type { Pharmacy } from "./types";
import {
  formatDistance,
  sortPharmacyResults,
  visiblePharmacyResults,
  type PharmacyResult,
} from "./results";

function pharmacy(id: string): Pharmacy {
  return {
    id,
    name: id,
    addressLine: "Address",
    addressAdditional: null,
    locality: "Paphos",
    district: "Paphos",
    postalCode: null,
    latitude: null,
    longitude: null,
    geocodeProvider: null,
    geocodeResultIdentifier: null,
    geocodeQuery: null,
    geocodeQuality: null,
    geocodedAt: null,
    phoneE164: null,
    housePhoneE164: null,
    housePhoneRaw: null,
    housePhoneE164Values: [],
    officialRegistrationNumber: null,
    pharmacistGivenName: null,
    pharmacistSurname: null,
    source: "test",
    sourceDataset: null,
    sourceResourceUrl: null,
    sourceRetrievedAt: null,
    intervals: [],
    dutyAssignments: [],
  };
}

function results(count: number): PharmacyResult[] {
  return Array.from({ length: count }, (_, index) => ({
    pharmacy: pharmacy(String(index + 1)),
    distanceKm: index + 1,
  }));
}

describe("pharmacy result ordering and presentation", () => {
  it("sorts known distances nearest first", () => {
    const sorted = sortPharmacyResults([
      { pharmacy: pharmacy("far"), distanceKm: 8 },
      { pharmacy: pharmacy("near"), distanceKm: 0.8 },
      { pharmacy: pharmacy("middle"), distanceKm: 2.5 },
    ]);
    expect(sorted.map((result) => result.pharmacy.id)).toEqual(["near", "middle", "far"]);
  });

  it("places unknown distances after all known distances", () => {
    const sorted = sortPharmacyResults([
      { pharmacy: pharmacy("unknown-a"), distanceKm: null },
      { pharmacy: pharmacy("known"), distanceKm: 3 },
      { pharmacy: pharmacy("unknown-b"), distanceKm: null },
    ]);
    expect(sorted.map((result) => result.pharmacy.id)).toEqual([
      "known",
      "unknown-a",
      "unknown-b",
    ]);
  });

  it("formats sub-kilometre distances in metres and longer distances to one decimal", () => {
    expect(formatDistance(0.742)).toBe("742 m");
    expect(formatDistance(1.24)).toBe("1.2 km");
  });

  it("does not limit results when geolocation is unavailable", () => {
    expect(
      visiblePharmacyResults(results(25), {
        filter: "all",
        locationKnown: false,
        expanded: false,
      }),
    ).toHaveLength(25);
  });

  it("initially limits the normal located result view to the nearest ten", () => {
    expect(
      visiblePharmacyResults(results(25), {
        filter: "all",
        locationKnown: true,
        expanded: false,
      }),
    ).toHaveLength(10);
  });

  it("does not truncate On Duty results", () => {
    expect(
      visiblePharmacyResults(results(15), {
        filter: "on_duty",
        locationKnown: true,
        expanded: false,
      }),
    ).toHaveLength(15);
  });
});
