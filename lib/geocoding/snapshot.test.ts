import { describe, expect, it } from "vitest";

import geocodingSnapshotJson from "../../data/geocoding/paphos-nominatim-2026.json";
import officialSnapshot from "../../data/official/cyprus-pharmacies-2026.json";

import { buildGeocodingQuery, reconcileNominatimResults } from "./nominatim";
import {
  summarizeGeocodingRecords,
  type GeocodingSnapshot,
} from "./snapshot";

const geocodingSnapshot = geocodingSnapshotJson as unknown as GeocodingSnapshot;

describe("checked-in Paphos geocoding reconciliation", () => {
  it("contains one cached reconciliation record per official Paphos pharmacy", () => {
    const paphosPharmacies = officialSnapshot.pharmacies.filter(
      (pharmacy) => pharmacy.district === "Paphos",
    );
    expect(geocodingSnapshot.records).toHaveLength(paphosPharmacies.length);
    expect(new Set(geocodingSnapshot.records.map((record) => record.officialRegistrationNumber)).size)
      .toBe(paphosPharmacies.length);
  });

  it("matches the current query builder, reconciler, and aggregate report", () => {
    const pharmacies = new Map(
      officialSnapshot.pharmacies.map((pharmacy) => [
        pharmacy.officialRegistrationNumber,
        pharmacy,
      ]),
    );

    for (const record of geocodingSnapshot.records) {
      const pharmacy = pharmacies.get(record.officialRegistrationNumber);
      expect(pharmacy).toBeDefined();
      expect(record.query).toBe(buildGeocodingQuery(pharmacy!));
      const reconciliation = reconcileNominatimResults(
        pharmacy!,
        record.providerResults,
      );
      expect(reconciliation.status).toBe(record.status);
      if (reconciliation.status === "accepted") {
        expect(record.accepted).toEqual(reconciliation.accepted);
      } else {
        expect(record.accepted).toBeNull();
        expect(record.reason).toBe(reconciliation.reason);
      }
    }

    expect(geocodingSnapshot.report).toEqual(
      summarizeGeocodingRecords(geocodingSnapshot.records),
    );
    expect(geocodingSnapshot.report).toMatchObject({
      selectedPharmacies: 90,
      attempted: 90,
      successfullyGeocoded: 8,
      ambiguous: 40,
      failed: 42,
      coordinatesAlreadyPresent: 0,
      qualityDistribution: { high: 6, medium: 2 },
    });
  });
});
