import type { GeocodeQuality } from "../domain/types";
import {
  coordinatesInBounds,
  geocodingHouseNumbers,
  geocodingLocalityAliases,
  normalizeGeocodingText,
  significantGeocodingStreetTokens,
  textContainsGeocodingAlias,
  type GeocodingAddress,
} from "./nominatim";

export const GEOAPIFY_ENDPOINT = "https://api.geoapify.com/v1/geocode/search";
export const GEOAPIFY_PROVIDER = "geoapify";

export const PAPHOS_DISTRICT_BOUNDS = {
  south: 34.54,
  north: 35.2,
  west: 32.2,
  east: 32.82,
};

export interface GeoapifyResult {
  place_id: string;
  lat: number;
  lon: number;
  formatted: string;
  address_line1?: string;
  address_line2?: string;
  name?: string;
  country?: string;
  country_code?: string;
  state?: string;
  state_code?: string;
  state_district?: string;
  county?: string;
  city?: string;
  municipality?: string;
  town?: string;
  village?: string;
  suburb?: string;
  district?: string;
  city_district?: string;
  hamlet?: string;
  commune?: string;
  postcode?: string;
  street?: string;
  housenumber?: string;
  iso3166_2?: string;
  result_type?: string;
  category?: string;
  other_names?: Record<string, string>;
  rank?: {
    importance?: number;
    popularity?: number;
    confidence?: number;
    confidence_city_level?: number;
    confidence_street_level?: number;
    confidence_building_level?: number;
    match_type?: string;
  };
  datasource?: {
    sourcename?: string;
    attribution?: string;
    license?: string;
    url?: string;
  };
  [key: string]: unknown;
}

export interface GeoapifyResponse {
  results?: GeoapifyResult[];
}

export interface AcceptedGeoapifyResult {
  latitude: number;
  longitude: number;
  resultIdentifier: string;
  displayName: string;
  quality: GeocodeQuality;
  reasons: string[];
  matchMetadata: {
    resultType: string | null;
    category: string | null;
    matchType: string | null;
    providerConfidence: number | null;
    sourceName: string | null;
    sourceAttribution: string | null;
  };
}

export type GeoapifyReconciliation =
  | { status: "accepted"; accepted: AcceptedGeoapifyResult }
  | { status: "ambiguous"; reason: string }
  | { status: "failed"; reason: string };

export interface ManualLocationSuggestion {
  resultIdentifier: string;
  label: string;
  latitude: number;
  longitude: number;
  resultType: string | null;
}

interface CandidateEvaluation {
  result: GeoapifyResult;
  latitude: number;
  longitude: number;
  score: number;
  quality: GeocodeQuality | null;
  reasons: string[];
}

function paphosRectangleFilter(): string {
  const bounds = PAPHOS_DISTRICT_BOUNDS;
  return `rect:${bounds.west},${bounds.south},${bounds.east},${bounds.north}`;
}

export function buildGeoapifySearchUrl(
  query: string,
  apiKey: string,
  options: { limit?: number; language?: string } = {},
): string {
  const url = new URL(GEOAPIFY_ENDPOINT);
  url.searchParams.set("text", query);
  url.searchParams.set("format", "json");
  url.searchParams.set("filter", paphosRectangleFilter());
  url.searchParams.set("bias", "proximity:32.425,34.775");
  url.searchParams.set("limit", String(options.limit ?? 5));
  url.searchParams.set("lang", options.language ?? "en");
  url.searchParams.set("apiKey", apiKey);
  return url.toString();
}

export function buildManualLocationQuery(value: string): string {
  const trimmed = value.trim().replace(/\s+/g, " ");
  return `${trimmed}, Paphos District, Cyprus`;
}

function resultIsInPaphos(result: GeoapifyResult): boolean {
  if (
    result.country_code?.toLocaleLowerCase("en") !== "cy" ||
    !Number.isFinite(result.lat) ||
    !Number.isFinite(result.lon) ||
    !coordinatesInBounds(result.lat, result.lon, PAPHOS_DISTRICT_BOUNDS)
  ) {
    return false;
  }

  if (result.iso3166_2) return result.iso3166_2.toLocaleUpperCase("en") === "CY-05";

  const districtText = normalizeGeocodingText(
    [result.state, result.state_district, result.county].filter(Boolean).join(" "),
  );
  return textContainsGeocodingAlias(districtText, [
    "Paphos",
    "Pafos",
    "Επαρχία Πάφου",
  ]);
}

function specificLocalityText(result: GeoapifyResult): string {
  return normalizeGeocodingText(
    [
      result.city,
      result.municipality,
      result.town,
      result.village,
      result.suburb,
      result.district,
      result.city_district,
      result.hamlet,
      result.commune,
    ]
      .filter(Boolean)
      .join(" "),
  );
}

function streetText(result: GeoapifyResult): string {
  return normalizeGeocodingText(
    [
      result.street,
      result.name,
      result.address_line1,
      ...Object.values(result.other_names ?? {}),
    ]
      .filter(Boolean)
      .join(" "),
  );
}

function isPharmacyPoi(result: GeoapifyResult): boolean {
  return normalizeGeocodingText(result.category ?? "")
    .split(" ")
    .includes("pharmacy");
}

function evaluateCandidate(
  source: GeocodingAddress,
  result: GeoapifyResult,
): CandidateEvaluation | null {
  if (!resultIsInPaphos(result)) return null;

  const sourcePostcode = normalizeGeocodingText(source.postalCode ?? "");
  const postcodeMatch =
    sourcePostcode !== "" && normalizeGeocodingText(result.postcode ?? "") === sourcePostcode;
  const localityMatch = textContainsGeocodingAlias(
    specificLocalityText(result),
    geocodingLocalityAliases(source.locality),
  );
  const sourceStreetTokens = significantGeocodingStreetTokens(source.addressLine);
  const normalizedStreet = streetText(result);
  const matchingStreetTokens = sourceStreetTokens.filter((token) =>
    normalizedStreet.includes(token),
  );
  const streetMatch =
    sourceStreetTokens.length > 0 &&
    matchingStreetTokens.length >= Math.min(2, sourceStreetTokens.length);
  const houseNumber = normalizeGeocodingText(result.housenumber ?? "");
  const houseNumberMatch =
    houseNumber !== "" && geocodingHouseNumbers(source.addressLine).includes(houseNumber);
  const pharmacyPoi = isPharmacyPoi(result);
  const normalizedCategory = normalizeGeocodingText(result.category ?? "");
  const categorySupportsBuilding =
    normalizedCategory === "" || normalizedCategory.startsWith("building");
  const preciseResult =
    (result.result_type === "building" && categorySupportsBuilding) || pharmacyPoi;
  const fullMatch = result.rank?.match_type === "full_match";

  let score = 0;
  const reasons: string[] = ["country", "district"];
  if (postcodeMatch) {
    score += 5;
    reasons.push("postcode");
  }
  if (localityMatch) {
    score += 4;
    reasons.push("locality");
  }
  if (streetMatch) {
    score += 3;
    reasons.push("street");
  }
  if (houseNumberMatch) {
    score += 3;
    reasons.push("house_number");
  }
  if (pharmacyPoi) {
    score += 2;
    reasons.push("pharmacy_poi");
  }
  if (fullMatch) {
    score += 1;
    reasons.push("provider_full_match");
  }

  const high =
    preciseResult && postcodeMatch && localityMatch && streetMatch && houseNumberMatch;
  const medium =
    preciseResult &&
    ((houseNumberMatch && localityMatch && streetMatch) ||
      (pharmacyPoi && localityMatch && (postcodeMatch || streetMatch)));

  return {
    result,
    latitude: result.lat,
    longitude: result.lon,
    score,
    quality: high ? "high" : medium ? "medium" : null,
    reasons,
  };
}

function coordinatesDiffer(left: CandidateEvaluation, right: CandidateEvaluation): boolean {
  return (
    Math.abs(left.latitude - right.latitude) > 0.0005 ||
    Math.abs(left.longitude - right.longitude) > 0.0005
  );
}

export function reconcileGeoapifyResults(
  source: GeocodingAddress,
  results: GeoapifyResult[],
): GeoapifyReconciliation {
  if (results.length === 0) {
    return { status: "failed", reason: "Provider returned no results." };
  }

  const candidates = results
    .map((result) => evaluateCandidate(source, result))
    .filter((candidate): candidate is CandidateEvaluation => candidate !== null)
    .sort(
      (left, right) =>
        right.score - left.score ||
        (right.result.rank?.confidence ?? 0) - (left.result.rank?.confidence ?? 0) ||
        (right.result.rank?.importance ?? 0) - (left.result.rank?.importance ?? 0),
    );
  const best = candidates[0];

  if (!best?.quality) {
    return {
      status: "ambiguous",
      reason:
        "No precise result matched enough official locality, postcode, street, or house-number evidence.",
    };
  }

  const equallySupported = candidates.find(
    (candidate, index) =>
      index > 0 &&
      candidate.score === best.score &&
      candidate.quality === best.quality &&
      coordinatesDiffer(candidate, best),
  );
  if (equallySupported) {
    return {
      status: "ambiguous",
      reason: "Multiple differently located results had equal matching evidence.",
    };
  }

  return {
    status: "accepted",
    accepted: {
      latitude: best.latitude,
      longitude: best.longitude,
      resultIdentifier: best.result.place_id,
      displayName: best.result.formatted,
      quality: best.quality,
      reasons: best.reasons,
      matchMetadata: {
        resultType: best.result.result_type ?? null,
        category: best.result.category ?? null,
        matchType: best.result.rank?.match_type ?? null,
        providerConfidence: best.result.rank?.confidence ?? null,
        sourceName: best.result.datasource?.sourcename ?? null,
        sourceAttribution: best.result.datasource?.attribution ?? null,
      },
    },
  };
}

export function manualLocationSuggestions(
  results: GeoapifyResult[],
): ManualLocationSuggestion[] {
  const seen = new Set<string>();
  const coarseTypes = new Set(["country", "state", "county"]);

  return results.flatMap((result) => {
    if (!resultIsInPaphos(result) || coarseTypes.has(result.result_type ?? "")) return [];
    const key = `${result.place_id}:${result.lat.toFixed(5)}:${result.lon.toFixed(5)}`;
    if (seen.has(key)) return [];
    seen.add(key);
    return [
      {
        resultIdentifier: result.place_id,
        label: result.formatted,
        latitude: result.lat,
        longitude: result.lon,
        resultType: result.result_type ?? null,
      },
    ];
  });
}
