import { afterEach, describe, expect, it, vi } from "vitest";

import { runPaphosGeocodingSync } from "./sync-geocoding-snapshots";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("offline Paphos geocoding snapshot sync", () => {
  it("builds the expected 89-of-92 trusted-location plan without network calls", async () => {
    const fetch = vi.fn(() => {
      throw new Error("offline sync attempted a network call");
    });
    vi.stubGlobal("fetch", fetch);

    const result = await runPaphosGeocodingSync({
      now: new Date("2026-10-08T10:00:00.000Z"),
    });

    expect(fetch).not.toHaveBeenCalled();
    expect(result.mode).toBe("dry-run");
    expect(result.writes).toBeNull();
    expect(result.counts).toMatchObject({
      paphosPharmacies: 92,
      googleExact: 86,
      googleProbable: 3,
      googleAmbiguous: 3,
      googleNoMatch: 0,
      freshExactGoogleCoordinates: 86,
      acceptedFallbackArtifacts: 27,
      disputedFallbacksExcluded: 7,
      trustedFallbackRowsToPersist: 20,
      trustedFallbackOverlapWithExactGoogle: 17,
      trustedFallbackCoverageBeyondGoogle: 3,
      currentTrustedLocationCoverage: 89,
      currentUnresolved: 3,
      fallbackOnlyTrustedLocationCoverage: 20,
      fallbackOnlyUnresolved: 72,
      materialDisagreementsOver250Meters: 7,
      manualReview: 13,
    });
    expect(result.googleRows).toHaveLength(92);
    expect(
      result.googleRows.some(
        (row) => row.official_registration_number === "1280",
      ),
    ).toBe(false);
    expect(
      result.googleRows.find(
        (row) => row.official_registration_number === "1430",
      ),
    ).toMatchObject({
      place_id: "ChIJmQggJdAH5xQRL2KIf4Ll3mE",
      classification: "exact_identity_match",
    });
    expect(
      result.googleRows.find(
        (row) => row.official_registration_number === "1439",
      ),
    ).toMatchObject({
      place_id: "ChIJGcWVHYUH5xQRG3s6wPkBEsk",
      classification: "exact_identity_match",
    });
  });

  it("drops expired Google coordinates and leaves trusted fallback coordinates available", async () => {
    const result = await runPaphosGeocodingSync({
      now: new Date("2026-11-07T10:00:00.000Z"),
    });

    expect(result.counts.freshExactGoogleCoordinates).toBe(0);
    expect(result.counts.currentTrustedLocationCoverage).toBe(20);
    expect(result.counts.currentUnresolved).toBe(72);
    expect(result.googleRows.every((row) => row.latitude === null)).toBe(true);
    expect(result.pharmacyGeocodingUpdates).toHaveLength(20);
  });

  it("keeps non-exact Google candidates out of database coordinates", async () => {
    const result = await runPaphosGeocodingSync({
      now: new Date("2026-10-08T10:00:00.000Z"),
    });
    const nonExact = result.googleRows.filter(
      (row) => row.classification !== "exact_identity_match",
    );

    expect(nonExact).toHaveLength(6);
    expect(nonExact.every((row) => row.latitude === null && row.longitude === null)).toBe(true);
    expect(
      result.googleRows.every(
        (row) =>
          row.display_name === null &&
          row.formatted_address === null &&
          row.google_phone_e164 === null,
      ),
    ).toBe(true);
  });

  it("keeps registration 607 on fresh exact Google coordinates and preserves its fallback", async () => {
    const result = await runPaphosGeocodingSync({
      now: new Date("2026-10-08T10:00:00.000Z"),
    });
    const google607 = result.googleRows.find(
      (row) => row.official_registration_number === "607",
    );
    const fallback607 = result.pharmacyGeocodingUpdates.find(
      (row) => row.officialRegistrationNumber === "607",
    );
    const review607 = result.manualReview.find(
      (row) => row.registrationNumber === "607",
    );

    expect(google607).toMatchObject({
      latitude: 34.7565252,
      longitude: 32.4164677,
      classification: "exact_identity_match",
    });
    expect(fallback607).toBeUndefined();
    expect(review607?.fallbackCoordinates).toMatchObject({
      latitude: 34.7490029,
      longitude: 32.4241615,
    });
    expect(review607?.fallbackProvider).toBe("geoapify");
    expect(review607?.distanceDisagreementMeters).toBeCloseTo(1093, 0);
  });
});
