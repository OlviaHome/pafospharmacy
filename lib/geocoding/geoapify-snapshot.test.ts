import { describe, expect, it } from "vitest";

import geoapifySnapshotJson from "../../data/geocoding/paphos-geoapify-2026.json";
import nominatimSnapshotJson from "../../data/geocoding/paphos-nominatim-2026.json";
import officialSnapshot from "../../data/official/cyprus-pharmacies-2026.json";

import {
  reconcileGeoapifyResults,
  type GeoapifyResult,
} from "./geoapify";
import { buildGeocodingQuery } from "./nominatim";
import {
  rejectDuplicateAcceptedResultIdentifiers,
  summarizeGeocodingRecords,
  type GeocodingSnapshot,
} from "./snapshot";

const geoapifySnapshot =
  geoapifySnapshotJson as unknown as GeocodingSnapshot<GeoapifyResult>;
const nominatimSnapshot = nominatimSnapshotJson as unknown as GeocodingSnapshot;

describe("checked-in Geoapify Paphos reconciliation", () => {
  it("attempts exactly the pharmacies unresolved by the first provider", () => {
    const activeRegistrations = new Set(
      officialSnapshot.pharmacies
        .filter((pharmacy) => pharmacy.district === "Paphos")
        .map((pharmacy) => pharmacy.officialRegistrationNumber),
    );
    const nominatimAccepted = new Set(
      nominatimSnapshot.records
        .filter(
          (record) =>
            record.status === "accepted" &&
            activeRegistrations.has(record.officialRegistrationNumber),
        )
        .map((record) => record.officialRegistrationNumber),
    );
    const expected = officialSnapshot.pharmacies
      .filter(
        (pharmacy) =>
          pharmacy.district === "Paphos" &&
          !nominatimAccepted.has(pharmacy.officialRegistrationNumber),
      )
      .map((pharmacy) => pharmacy.officialRegistrationNumber);
    const registrationsWithoutHistoricalFallbackLookup = new Set([
      "1430",
      "1433",
      "1434",
      "1438",
      "1439",
    ]);
    const activeGeoapifyRecords = geoapifySnapshot.records.filter((record) =>
      activeRegistrations.has(record.officialRegistrationNumber),
    );

    expect(activeGeoapifyRecords.map((record) => record.officialRegistrationNumber)).toEqual(
      expected.filter(
        (registration) =>
          !registrationsWithoutHistoricalFallbackLookup.has(registration),
      ),
    );
    expect(geoapifySnapshot.records).toHaveLength(82);
    expect(
      geoapifySnapshot.records
        .filter((record) => !activeRegistrations.has(record.officialRegistrationNumber))
        .map((record) => record.officialRegistrationNumber),
    ).toEqual(["731", "1332"]);
  });

  it("matches the current query, conservative reconciler, duplicate guard, and report", () => {
    const pharmacies = new Map(
      officialSnapshot.pharmacies.map((pharmacy) => [
        pharmacy.officialRegistrationNumber,
        pharmacy,
      ]),
    );
    const reconciled = geoapifySnapshot.records.map((record) => {
      const pharmacy = pharmacies.get(record.officialRegistrationNumber);
      if (!pharmacy) return record;
      expect(record.query).toBe(buildGeocodingQuery(pharmacy));
      const result = reconcileGeoapifyResults(pharmacy, record.providerResults);
      return {
        ...record,
        status: result.status,
        reason: result.status === "accepted" ? null : result.reason,
        accepted: result.status === "accepted" ? result.accepted : null,
      };
    });
    const withDuplicateGuard = rejectDuplicateAcceptedResultIdentifiers(reconciled);

    expect(geoapifySnapshot.records).toEqual(withDuplicateGuard);
    expect(geoapifySnapshot.report).toEqual(
      summarizeGeocodingRecords(geoapifySnapshot.records),
    );
    expect(geoapifySnapshot.report).toMatchObject({
      selectedPharmacies: 82,
      attempted: 82,
      successfullyGeocoded: 20,
      ambiguous: 57,
      failed: 5,
      coordinatesAlreadyPresent: 0,
      qualityDistribution: { high: 16, medium: 4 },
    });
  });

  it("raises total trusted coordinate coverage to 28 of 90 without provider overlap", () => {
    const firstProvider = new Set(
      nominatimSnapshot.records
        .filter((record) => record.status === "accepted")
        .map((record) => record.officialRegistrationNumber),
    );
    const secondProvider = new Set(
      geoapifySnapshot.records
        .filter((record) => record.status === "accepted")
        .map((record) => record.officialRegistrationNumber),
    );
    expect([...secondProvider].some((registration) => firstProvider.has(registration))).toBe(
      false,
    );
    expect(firstProvider.size + secondProvider.size).toBe(28);
  });
});
