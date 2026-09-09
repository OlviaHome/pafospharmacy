import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { PAPHOS_DISPUTED_FALLBACK_REGISTRATION_NUMBERS } from "@/lib/geocoding/google-places";

import { getPharmacyDataset } from "./pharmacies";

describe("Google Places pharmacy data selection", () => {
  it("prefers only fresh exact Google coordinates and keeps every Paphos pharmacy", async () => {
    const dataset = await getPharmacyDataset(new Date("2026-09-04T10:00:00Z"));
    const registration607 = dataset.pharmacies.find(
      (pharmacy) => pharmacy.officialRegistrationNumber === "607",
    );
    const probable433 = dataset.pharmacies.find(
      (pharmacy) => pharmacy.officialRegistrationNumber === "433",
    );

    expect(dataset.pharmacies).toHaveLength(90);
    expect(
      dataset.pharmacies.filter(
        (pharmacy) => pharmacy.geocodeProvider === "google_places",
      ),
    ).toHaveLength(81);
    expect(
      dataset.pharmacies.filter((pharmacy) => pharmacy.latitude !== null),
    ).toHaveLength(84);
    expect(registration607).toMatchObject({
      latitude: 34.7565252,
      longitude: 32.4164677,
      geocodeProvider: "google_places",
    });
    for (const registration of PAPHOS_DISPUTED_FALLBACK_REGISTRATION_NUMBERS) {
      expect(
        dataset.pharmacies.find(
          (pharmacy) => pharmacy.officialRegistrationNumber === registration,
        )?.geocodeProvider,
      ).toBe("google_places");
    }
    expect(probable433?.geocodeProvider).not.toBe("google_places");
    expect(dataset.coordinateAttributions.map((item) => item.providerId)).toContain(
      "google_places",
    );
  });

  it("falls back to retained enrichment after the Google cache expires", async () => {
    const dataset = await getPharmacyDataset(new Date("2026-10-04T10:00:00Z"));
    const registration607 = dataset.pharmacies.find(
      (pharmacy) => pharmacy.officialRegistrationNumber === "607",
    );

    expect(
      dataset.pharmacies.filter(
        (pharmacy) => pharmacy.geocodeProvider === "google_places",
      ),
    ).toHaveLength(0);
    expect(
      dataset.pharmacies.filter((pharmacy) => pharmacy.latitude !== null),
    ).toHaveLength(21);
    expect(registration607).toMatchObject({
      latitude: null,
      longitude: null,
      geocodeProvider: null,
    });
    for (const registration of PAPHOS_DISPUTED_FALLBACK_REGISTRATION_NUMBERS) {
      expect(
        dataset.pharmacies.find(
          (pharmacy) => pharmacy.officialRegistrationNumber === registration,
        ),
      ).toMatchObject({
        latitude: null,
        longitude: null,
        geocodeProvider: null,
      });
    }
    expect(dataset.coordinateAttributions.map((item) => item.providerId)).not.toContain(
      "google_places",
    );
  });
});
