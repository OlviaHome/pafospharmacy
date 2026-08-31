import { describe, expect, it } from "vitest";

import {
  buildGeocodingQuery,
  normalizeGeocodingText,
  reconcileNominatimResults,
  type GeocodingAddress,
  type NominatimResult,
} from "./nominatim";

const source: GeocodingAddress = {
  addressLine: "Ελλάδος 74",
  addressAdditional: "Απέναντι από την αγορά",
  locality: "Πάφος",
  district: "Paphos",
  postalCode: "8020",
};

function result(overrides: Partial<NominatimResult> = {}): NominatimResult {
  return {
    place_id: 123,
    osm_type: "node",
    osm_id: 456,
    lat: "34.778",
    lon: "32.432",
    display_name: "74, Ελλάδος, Πάφος, 8020, Κύπρος",
    importance: 0.4,
    place_rank: 30,
    category: "place",
    type: "house",
    address: {
      house_number: "74",
      road: "Ελλάδος",
      city: "Πάφος",
      postcode: "8020",
      country: "Κύπρος",
      country_code: "cy",
    },
    ...overrides,
  };
}

describe("Nominatim geocoding normalization", () => {
  it("normalizes Greek accents, punctuation, case, and final sigma", () => {
    expect(normalizeGeocodingText("  Πάφος — ΕΛΛΆΔΟΣ  ")).toBe("παφοσ ελλαδοσ");
  });

  it("builds a reproducible query from official address fields without landmarks", () => {
    expect(buildGeocodingQuery(source)).toBe(
      "Ελλάδος 74, Πάφος, Paphos District, 8020, Cyprus",
    );
  });

  it("accepts an exact Cyprus address with high reconciliation quality", () => {
    expect(reconcileNominatimResults(source, [result()])).toEqual({
      status: "accepted",
      accepted: {
        latitude: 34.778,
        longitude: 32.432,
        resultIdentifier: "node:456",
        displayName: "74, Ελλάδος, Πάφος, 8020, Κύπρος",
        quality: "high",
        reasons: ["postcode", "locality", "street", "house_number", "country", "district"],
      },
    });
  });

  it("does not accept a result outside Cyprus", () => {
    const reconciliation = reconcileNominatimResults(source, [
      result({
        lat: "37.9838",
        lon: "23.7275",
        address: { country: "Ελλάδα", country_code: "gr" },
      }),
    ]);
    expect(reconciliation.status).toBe("ambiguous");
  });

  it("does not accept a Cyprus result from a different official district", () => {
    const reconciliation = reconcileNominatimResults(source, [
      result({
        lat: "35.1856",
        lon: "33.3823",
        display_name: "74, Ελλάδος, Λευκωσία, 1010, Κύπρος",
        address: {
          house_number: "74",
          road: "Ελλάδος",
          city: "Λευκωσία",
          postcode: "1010",
          "ISO3166-2-lvl5": "CY-01",
          country: "Κύπρος",
          country_code: "cy",
        },
      }),
    ]);
    expect(reconciliation.status).toBe("ambiguous");
  });

  it("flags locality-only results as ambiguous instead of assigning a town centre", () => {
    const reconciliation = reconcileNominatimResults(source, [
      result({
        place_rank: 16,
        category: "place",
        type: "city",
        display_name: "Πάφος, Κύπρος",
        address: { city: "Πάφος", country: "Κύπρος", country_code: "cy" },
      }),
    ]);
    expect(reconciliation).toEqual({
      status: "ambiguous",
      reason: "No result matched enough official postcode, locality, street, or house-number evidence.",
    });
  });

  it("flags a matching road centroid as ambiguous without a house or pharmacy POI", () => {
    const reconciliation = reconcileNominatimResults(source, [
      result({
        category: "highway",
        type: "secondary",
        display_name: "Ελλάδος, Πάφος, 8020, Κύπρος",
        address: {
          road: "Ελλάδος",
          city: "Πάφος",
          postcode: "8020",
          country: "Κύπρος",
          country_code: "cy",
        },
      }),
    ]);
    expect(reconciliation.status).toBe("ambiguous");
  });

  it("flags equally supported results at different locations", () => {
    const reconciliation = reconcileNominatimResults(source, [
      result(),
      result({ place_id: 124, osm_id: 457, lat: "34.788", lon: "32.442" }),
    ]);
    expect(reconciliation).toEqual({
      status: "ambiguous",
      reason: "Multiple differently located results had equal matching evidence.",
    });
  });
});
