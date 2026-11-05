import { describe, expect, it } from "vitest";

import geocodingSnapshotJson from "../../data/geocoding/paphos-nominatim-2026.json";
import officialSnapshot from "../../data/official/cyprus-pharmacies-2026.json";

import { buildGeocodingQuery, reconcileNominatimResults } from "./nominatim";
import {
  rejectDuplicateAcceptedResultIdentifiers,
  summarizeGeocodingRecords,
  type GeocodingSnapshot,
} from "./snapshot";

const geocodingSnapshot = geocodingSnapshotJson as unknown as GeocodingSnapshot;

describe("checked-in Paphos geocoding reconciliation", () => {
  it("keeps its historical cohort while identifying the active Paphos records", () => {
    const paphosPharmacies = officialSnapshot.pharmacies.filter(
      (pharmacy) => pharmacy.district === "Paphos",
    );
    const activeRegistrations = new Set(
      paphosPharmacies.map((pharmacy) => pharmacy.officialRegistrationNumber),
    );
    const activeRecords = geocodingSnapshot.records.filter((record) =>
      activeRegistrations.has(record.officialRegistrationNumber),
    );

    expect(geocodingSnapshot.records).toHaveLength(90);
    expect(new Set(geocodingSnapshot.records.map((record) => record.officialRegistrationNumber)).size)
      .toBe(90);
    expect(activeRecords).toHaveLength(87);
    expect(
      geocodingSnapshot.records
        .filter((record) => !activeRegistrations.has(record.officialRegistrationNumber))
        .map((record) => record.officialRegistrationNumber),
    ).toEqual(["731", "1280", "1332"]);
    const snapshotRegistrations = new Set(
      geocodingSnapshot.records.map((record) => record.officialRegistrationNumber),
    );
    expect(
      paphosPharmacies
        .filter(
          (pharmacy) =>
            !snapshotRegistrations.has(pharmacy.officialRegistrationNumber),
        )
        .map((pharmacy) => pharmacy.officialRegistrationNumber),
    ).toEqual(["1430", "1433", "1434", "1438", "1439"]);
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
      if (!pharmacy) continue;
      expect(record.query).toBe(buildGeocodingQuery(pharmacy));
      const reconciliation = reconcileNominatimResults(
        pharmacy,
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

describe("provider result reconciliation", () => {
  it("rejects one provider result identifier reused for multiple official addresses", () => {
    const accepted = {
      latitude: 34.77,
      longitude: 32.42,
      resultIdentifier: "shared-provider-result",
      displayName: "Address",
      quality: "high" as const,
      reasons: ["country", "district"],
    };
    const records = ["100", "200"].map((registration) => ({
      officialRegistrationNumber: registration,
      query: `${registration}, Paphos`,
      attemptedAt: "2026-09-01T00:00:00.000Z",
      status: "accepted" as const,
      providerResults: [],
      reason: null,
      accepted,
    }));

    expect(rejectDuplicateAcceptedResultIdentifiers(records)).toEqual(
      records.map((record) => ({
        ...record,
        status: "ambiguous",
        reason:
          "Provider reused one result identifier for multiple official pharmacy addresses.",
        accepted: null,
      })),
    );
  });
});
