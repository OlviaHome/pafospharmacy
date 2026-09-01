import { describe, expect, it } from "vitest";

import {
  buildGeoapifySearchUrl,
  buildManualLocationQuery,
  manualLocationSuggestions,
  reconcileGeoapifyResults,
  type GeoapifyResult,
} from "./geoapify";
import type { GeocodingAddress } from "./nominatim";

const source: GeocodingAddress = {
  addressLine: "Ελλάδος 74",
  addressAdditional: null,
  locality: "Πάφος",
  district: "Paphos",
  postalCode: "8020",
};

function result(overrides: Partial<GeoapifyResult> = {}): GeoapifyResult {
  return {
    place_id: "geoapify-result-1",
    lat: 34.7866,
    lon: 32.4327,
    formatted: "Ελλάδος 74, 8020 Δήμος Πάφου, Κύπρος",
    country_code: "cy",
    state: "Επαρχία Πάφου",
    city: "Δήμος Πάφου",
    postcode: "8020",
    street: "Ελλάδος",
    housenumber: "74",
    iso3166_2: "CY-05",
    result_type: "building",
    rank: { confidence: 0.9, match_type: "full_match" },
    datasource: {
      sourcename: "openstreetmap",
      attribution: "© OpenStreetMap contributors",
    },
    ...overrides,
  };
}

describe("Geoapify pharmacy reconciliation", () => {
  it("constrains provider requests to the Paphos area without exposing a public key", () => {
    const url = new URL(buildGeoapifySearchUrl("Chloraka", "server-secret"));
    expect(url.origin + url.pathname).toBe("https://api.geoapify.com/v1/geocode/search");
    expect(url.searchParams.get("filter")).toMatch(/^rect:/);
    expect(url.searchParams.get("apiKey")).toBe("server-secret");
    expect(buildManualLocationQuery("  Chloraka  ")).toBe(
      "Chloraka, Paphos District, Cyprus",
    );
  });

  it("accepts a precise official address with high evidence", () => {
    const reconciliation = reconcileGeoapifyResults(source, [result()]);
    expect(reconciliation.status).toBe("accepted");
    if (reconciliation.status !== "accepted") return;
    expect(reconciliation.accepted).toMatchObject({
      latitude: 34.7866,
      longitude: 32.4327,
      resultIdentifier: "geoapify-result-1",
      quality: "high",
      reasons: [
        "country",
        "district",
        "postcode",
        "locality",
        "street",
        "house_number",
        "provider_full_match",
      ],
    });
  });

  it("grades a precise street and house match with a postcode discrepancy as medium", () => {
    const reconciliation = reconcileGeoapifyResults(source, [
      result({
        formatted: "Ελλάδος 74, 8021 Δήμος Πάφου, Κύπρος",
        postcode: "8021",
        rank: { confidence: 0, match_type: "full_match" },
      }),
    ]);
    expect(reconciliation.status).toBe("accepted");
    if (reconciliation.status === "accepted") {
      expect(reconciliation.accepted.quality).toBe("medium");
    }
  });

  it("rejects wrong-country and wrong-district candidates", () => {
    expect(
      reconcileGeoapifyResults(source, [
        result({ country_code: "gr", iso3166_2: "GR-I" }),
      ]).status,
    ).toBe("ambiguous");
    expect(
      reconcileGeoapifyResults(source, [
        result({ lat: 35.17, lon: 33.36, iso3166_2: "CY-01" }),
      ]).status,
    ).toBe("ambiguous");
  });

  it("does not accept street or city centroids as pharmacy coordinates", () => {
    const reconciliation = reconcileGeoapifyResults(source, [
      result({ result_type: "street", housenumber: undefined }),
      result({ result_type: "city", street: undefined, housenumber: undefined }),
    ]);
    expect(reconciliation.status).toBe("ambiguous");
  });

  it("does not promote a public-transport feature mislabeled as a building", () => {
    expect(
      reconcileGeoapifyResults(source, [
        result({ category: "public_transport.bus", result_type: "building" }),
      ]).status,
    ).toBe("ambiguous");
  });

  it("keeps equally supported precise locations ambiguous", () => {
    const reconciliation = reconcileGeoapifyResults(source, [
      result(),
      result({ place_id: "geoapify-result-2", lat: 34.7966, lon: 32.4427 }),
    ]);
    expect(reconciliation).toEqual({
      status: "ambiguous",
      reason: "Multiple differently located results had equal matching evidence.",
    });
  });
});

describe("Geoapify manual location results", () => {
  it("returns explicit Paphos suggestions for user disambiguation", () => {
    expect(
      manualLocationSuggestions([
        result({ result_type: "city", housenumber: undefined, street: undefined }),
        result({
          place_id: "wrong-district",
          lat: 35.17,
          lon: 33.36,
          iso3166_2: "CY-01",
        }),
      ]),
    ).toEqual([
      {
        resultIdentifier: "geoapify-result-1",
        label: "Ελλάδος 74, 8020 Δήμος Πάφου, Κύπρος",
        latitude: 34.7866,
        longitude: 32.4327,
        resultType: "city",
      },
    ]);
  });
});
