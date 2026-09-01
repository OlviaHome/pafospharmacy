import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { Pharmacy } from "@/lib/domain/types";

import { PharmacyFinder } from "./pharmacy-finder";

const pharmacy: Pharmacy = {
  id: "pharmacy-1",
  name: "Test Pharmacy",
  addressLine: "1 Test Street",
  addressAdditional: null,
  locality: "Paphos",
  district: "Paphos",
  postalCode: "8010",
  latitude: 34.77,
  longitude: 32.42,
  geocodeProvider: "test",
  geocodeResultIdentifier: "test-result",
  geocodeQuery: "1 Test Street, Paphos",
  geocodeQuality: "high",
  geocodedAt: "2026-09-01T10:00:00.000Z",
  phoneE164: "+35726000000",
  housePhoneE164: null,
  housePhoneRaw: null,
  housePhoneE164Values: [],
  officialRegistrationNumber: "1",
  pharmacistGivenName: "Test",
  pharmacistSurname: "Pharmacist",
  source: "test",
  sourceDataset: null,
  sourceResourceUrl: null,
  sourceRetrievedAt: null,
  intervals: [],
  dutyAssignments: [],
};

describe("PharmacyFinder location controls", () => {
  it("renders GPS, manual search, and complete no-origin browse paths", () => {
    const markup = renderToStaticMarkup(
      <PharmacyFinder
        pharmacies={[pharmacy]}
        source="official_snapshot"
        generatedAt="2026-09-01T10:00:00.000Z"
        ordinaryOpeningDataAvailable={false}
        attribution={null}
        coordinateAttributions={[]}
      />,
    );

    expect(markup).toContain("Find pharmacies near you");
    expect(markup).toContain("Use my location");
    expect(markup).toContain("Enter area or address");
    expect(markup).toContain(
      "You can also browse all pharmacies without sharing your location.",
    );
    expect(markup).toContain("Test Pharmacy");
  });
});
