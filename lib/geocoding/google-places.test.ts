import { describe, expect, it } from "vitest";

import {
  GOOGLE_COORDINATE_CACHE_DAYS,
  GOOGLE_PLACES_FIELD_MASK,
  buildGooglePhoneQuery,
  googleCacheRecord,
  isGoogleCoordinateCacheUsable,
  isTrustedGoogleCoordinateCache,
  normalizeGooglePhone,
  purgeExpiredGoogleContent,
  reconcileGooglePlacesResults,
  rejectDuplicateTrustedGooglePlaceIds,
  type GooglePlaceResult,
} from "./google-places";

const pharmacy = {
  name: "Μάη - Φραγκούδη Ελένη",
  phoneE164: "+35726938784",
  addressLine: "Ποσειδώνος 41",
  locality: "Κάτω Πάφος",
  postalCode: "8042",
};

function place(overrides: Partial<GooglePlaceResult> = {}): GooglePlaceResult {
  return {
    id: "google-place-607",
    displayName: { text: "Helen's Pharmacy" },
    formattedAddress: "Paphos 8041, Cyprus",
    location: { latitude: 34.7565252, longitude: 32.4164677 },
    internationalPhoneNumber: "+357 26 938784",
    ...overrides,
  };
}

describe("Google Places pharmacy reconciliation", () => {
  it("uses only the approved Places fields", () => {
    expect(GOOGLE_PLACES_FIELD_MASK.split(",")).toEqual([
      "places.id",
      "places.displayName",
      "places.formattedAddress",
      "places.location",
      "places.nationalPhoneNumber",
      "places.internationalPhoneNumber",
    ]);
  });

  it("normalizes national and international Cyprus phone formats", () => {
    expect(normalizeGooglePhone("26 938784")).toBe("+35726938784");
    expect(normalizeGooglePhone("+357 26 938784")).toBe("+35726938784");
    expect(buildGooglePhoneQuery("+35726938784")).toBe("+357 26938784");
  });

  it("accepts registration 607 by exact phone and compatible Paphos evidence", () => {
    const result = reconcileGooglePlacesResults(pharmacy, [place()]);
    expect(result.classification).toBe("exact_identity_match");
    expect(result.matchingEvidence).toContain("phone_exact");
    expect(result.matchingEvidence).toContain("paphos_address");
  });

  it("accepts an exact phone with a compatible street and house number", () => {
    const result = reconcileGooglePlacesResults(
      {
        ...pharmacy,
        addressLine: "Βασιλέως Στασιοίκου 1",
        locality: "Πόλις Χρυσοχούς",
        postalCode: "8835",
      },
      [
        place({
          formattedAddress: "Vasileos Stasioikou 1, Poli Crysochous 8820",
        }),
      ],
    );
    expect(result.classification).toBe("exact_identity_match");
    expect(result.matchingEvidence).toContain("house_number_compatible");
    expect(result.matchingEvidence).toContain("street_tokens:2");
  });

  it("allows ordinary Greek-to-Latin vowel variation in address verification", () => {
    const result = reconcileGooglePlacesResults(
      {
        ...pharmacy,
        name: "Μαυρίκου Ελένη",
        addressLine: "Βορείου Ηπείρου 6",
      },
      [
        place({
          displayName: { text: "Mavrikou Pharmacy" },
          formattedAddress: "Voreiou Ipeirou 6, Baf 8035",
        }),
      ],
    );
    expect(result.classification).toBe("exact_identity_match");
    expect(result.matchingEvidence).toContain("house_number_compatible");
    expect(result.matchingEvidence).toContain("street_tokens:2");
  });

  it("never accepts a result solely because the name is similar", () => {
    const result = reconcileGooglePlacesResults(pharmacy, [
      place({
        id: "wrong-place",
        formattedAddress: "Nicosia, Cyprus",
        location: { latitude: 35.18, longitude: 33.38 },
        internationalPhoneNumber: "+357 22 000000",
      }),
    ]);
    expect(result.classification).toBe("no_match");
    expect(result.selected).toBeNull();
  });

  it("keeps strong name/address evidence with a conflicting phone probable", () => {
    const result = reconcileGooglePlacesResults(
      {
        name: "Νικολαϊδου Κωνσταντία",
        phoneE164: "+35726935642",
        addressLine: "Γεωργίου Χ. Ιωαννίδη 5",
        locality: "Πάφος",
        postalCode: "8063",
      },
      [
        place({
          id: "probable-place",
          displayName: { text: "Constantia Nicolaidou Pharmacy" },
          formattedAddress: "Georgiou Ch. Ioannide 5, Pafos 8036, Cyprus",
          internationalPhoneNumber: "+357 99 523952",
          location: { latitude: 34.7623588, longitude: 32.4292624 },
        }),
      ],
    );
    expect(result.classification).toBe("probable_match");
    expect(result.matchingEvidence).toContain("phone_conflict");
  });

  it("uses exact Google coordinates only until the 30-day expiry", () => {
    const retrievedAt = "2026-09-03T10:00:00.000Z";
    const record = googleCacheRecord(
      "607",
      reconcileGooglePlacesResults(pharmacy, [place()]),
      retrievedAt,
    );
    expect(GOOGLE_COORDINATE_CACHE_DAYS).toBe(30);
    expect(isGoogleCoordinateCacheUsable(record, new Date("2026-10-03T09:59:59Z"))).toBe(true);
    expect(isGoogleCoordinateCacheUsable(record, new Date("2026-10-03T10:00:00Z"))).toBe(false);
    expect(
      purgeExpiredGoogleContent(record, new Date("2026-10-03T10:00:00Z")),
    ).toMatchObject({
      placeId: "google-place-607",
      latitude: null,
      longitude: null,
      displayName: null,
      formattedAddress: null,
      googlePhoneE164: null,
    });
  });

  it("never uses probable coordinates for distance or directions", () => {
    const record = googleCacheRecord(
      "433",
      {
        classification: "probable_match",
        selected: place(),
        matchingEvidence: ["name_tokens:2", "street_tokens:2"],
        reason: "probable",
      },
      "2026-09-03T10:00:00.000Z",
    );
    expect(isGoogleCoordinateCacheUsable(record, new Date("2026-09-04T10:00:00Z"))).toBe(false);
  });

  it("requires the fresh cache to agree with the durable registration-to-Place-ID link", () => {
    const record = googleCacheRecord(
      "607",
      reconcileGooglePlacesResults(pharmacy, [place()]),
      "2026-09-03T10:00:00.000Z",
    );
    const link = {
      officialRegistrationNumber: "607",
      placeId: "different-place",
      classification: "exact_identity_match" as const,
      matchingEvidence: ["phone_exact"],
      retrievedAt: record.retrievedAt,
      coordinateDifferenceMeters: null,
      comparedProvider: null,
      comparedQuality: null,
      requiresManualReview: false,
    };
    expect(isTrustedGoogleCoordinateCache(record, link, new Date("2026-09-04"))).toBe(false);
    expect(
      isTrustedGoogleCoordinateCache(
        record,
        { ...link, placeId: record.placeId },
        new Date("2026-09-04"),
      ),
    ).toBe(true);
  });

  it("downgrades a Google Place ID claimed by multiple official pharmacies", () => {
    const exact = googleCacheRecord(
      "607",
      reconcileGooglePlacesResults(pharmacy, [place()]),
      "2026-09-03T10:00:00.000Z",
    );
    const records = rejectDuplicateTrustedGooglePlaceIds([
      exact,
      { ...exact, officialRegistrationNumber: "999" },
    ]);
    expect(records.map((record) => record.classification)).toEqual([
      "ambiguous",
      "ambiguous",
    ]);
    expect(records[0].matchingEvidence).toContain("duplicate_place_id");
  });
});
