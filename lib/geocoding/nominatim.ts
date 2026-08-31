import type { GeocodeQuality } from "@/lib/domain/types";

export const NOMINATIM_ENDPOINT = "https://nominatim.openstreetmap.org/search";
export const NOMINATIM_PROVIDER = "openstreetmap_nominatim";

export interface GeocodingAddress {
  addressLine: string;
  addressAdditional: string | null;
  locality: string;
  district: string | null;
  postalCode: string | null;
}

export interface NominatimResult {
  place_id: number;
  osm_type: string;
  osm_id: number;
  lat: string;
  lon: string;
  display_name: string;
  importance?: number;
  place_rank?: number;
  category?: string;
  type?: string;
  addresstype?: string;
  licence?: string;
  address?: Record<string, string>;
  boundingbox?: string[];
}

export interface AcceptedNominatimResult {
  latitude: number;
  longitude: number;
  resultIdentifier: string;
  displayName: string;
  quality: GeocodeQuality;
  reasons: string[];
}

export type NominatimReconciliation =
  | { status: "accepted"; accepted: AcceptedNominatimResult }
  | { status: "ambiguous"; reason: string }
  | { status: "failed"; reason: string };

interface CandidateEvaluation {
  result: NominatimResult;
  latitude: number;
  longitude: number;
  score: number;
  quality: GeocodeQuality | null;
  reasons: string[];
}

const CYPRUS_BOUNDS = {
  south: 34.4,
  north: 35.8,
  west: 31.9,
  east: 34.7,
};

const DISTRICT_RULES: Record<string, { isoCode: string; aliases: string[] }> = {
  paphos: {
    isoCode: "CY-05",
    aliases: ["paphos", "pafos", "παφοσ", "παφου"],
  },
  nicosia: {
    isoCode: "CY-01",
    aliases: ["nicosia", "lefkosia", "λευκωσια", "λευκωσιασ"],
  },
  limassol: {
    isoCode: "CY-02",
    aliases: ["limassol", "lemesos", "λεμεσοσ", "λεμεσου"],
  },
  larnaca: {
    isoCode: "CY-03",
    aliases: ["larnaca", "larnaka", "λαρνακα", "λαρνακασ"],
  },
  famagusta: {
    isoCode: "CY-04",
    aliases: ["famagusta", "ammochostos", "αμμοχωστοσ", "αμμοχωστου"],
  },
};

const STREET_STOP_WORDS = new Set([
  "αγ",
  "αγιασ",
  "αγιου",
  "αρχ",
  "avenue",
  "ave",
  "λεωφ",
  "λεωφοροσ",
  "οδοσ",
  "road",
  "street",
  "str",
]);

function inBounds(
  latitude: number,
  longitude: number,
  bounds: typeof CYPRUS_BOUNDS,
): boolean {
  return (
    latitude >= bounds.south &&
    latitude <= bounds.north &&
    longitude >= bounds.west &&
    longitude <= bounds.east
  );
}

export function normalizeGeocodingText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("el")
    .replace(/ς/g, "σ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function uniqueParts(parts: Array<string | null>): string[] {
  const seen = new Set<string>();
  return parts.filter((part): part is string => {
    if (!part?.trim()) return false;
    const key = normalizeGeocodingText(part);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function buildGeocodingQuery(pharmacy: GeocodingAddress): string {
  return uniqueParts([
    pharmacy.addressLine,
    pharmacy.locality,
    pharmacy.district ? `${pharmacy.district} District` : null,
    pharmacy.postalCode,
    "Cyprus",
  ]).join(", ");
}

export function buildNominatimSearchUrl(query: string): string {
  const url = new URL(NOMINATIM_ENDPOINT);
  url.searchParams.set("q", query);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("addressdetails", "1");
  url.searchParams.set("limit", "5");
  url.searchParams.set("countrycodes", "cy");
  url.searchParams.set("accept-language", "el,en");
  return url.toString();
}

function localityAliases(locality: string): string[] {
  const normalized = normalizeGeocodingText(locality);
  const knownAliases: Record<string, string[]> = {
    "παφοσ": ["παφοσ", "παφου", "paphos", "pafos"],
    "κατω παφοσ": ["κατω παφοσ", "kato paphos", "kato pafos"],
    "γεροσκηπου": ["γεροσκηπου", "geroskipou", "yeroskipou"],
    "πολισ χρυσοχουσ": ["πολισ χρυσοχουσ", "πολη χρυσοχουσ", "polis chrysochous"],
    "χλωρακασ": ["χλωρακασ", "χλωρακα", "chloraka"],
    "χλωρακα": ["χλωρακασ", "χλωρακα", "chloraka"],
    "πεγεια": ["πεγεια", "peyia", "pegeia"],
    "κισσονεργα": ["κισσονεργα", "kissonerga"],
    "αναβαργοσ": ["αναβαργοσ", "αναβαργου", "anavargos"],
    "κονια": ["κονια", "konia"],
    "κουκλια": ["κουκλια", "kouklia"],
    "μεσογη": ["μεσογη", "mesogi"],
    "προδρομι": ["προδρομι", "prodromi"],
    "ταλα": ["ταλα", "tala"],
    "τιμη": ["τιμη", "timi"],
    "τρεμιθουσα": ["τρεμιθουσα", "tremithousa"],
  };
  return knownAliases[normalized] ?? [normalized];
}

function textContainsAlias(text: string, aliases: string[]): boolean {
  return aliases.some((alias) => text.includes(normalizeGeocodingText(alias)));
}

function significantStreetTokens(addressLine: string): string[] {
  return normalizeGeocodingText(addressLine)
    .split(" ")
    .filter(
      (token) =>
        token.length >= 3 &&
        !/^\d+[a-zα-ω]*$/u.test(token) &&
        !STREET_STOP_WORDS.has(token),
    );
}

function sourceHouseNumbers(addressLine: string): string[] {
  return normalizeGeocodingText(addressLine).match(/\b\d+[a-zα-ω]*\b/gu) ?? [];
}

function resultText(result: NominatimResult): string {
  return normalizeGeocodingText(
    [result.display_name, ...Object.values(result.address ?? {})].join(" "),
  );
}

function evaluateCandidate(
  source: GeocodingAddress,
  result: NominatimResult,
): CandidateEvaluation | null {
  const latitude = Number(result.lat);
  const longitude = Number(result.lon);
  const countryCode = normalizeGeocodingText(result.address?.country_code ?? "");
  if (
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    countryCode !== "cy" ||
    !inBounds(latitude, longitude, CYPRUS_BOUNDS)
  ) {
    return null;
  }

  const text = resultText(result);
  const sourcePostcode = normalizeGeocodingText(source.postalCode ?? "");
  const resultPostcode = normalizeGeocodingText(result.address?.postcode ?? "");
  const postcodeMatch = sourcePostcode !== "" && resultPostcode === sourcePostcode;
  const localityMatch = textContainsAlias(text, localityAliases(source.locality));
  const districtText = normalizeGeocodingText(source.district ?? "");
  const districtRule = DISTRICT_RULES[districtText];
  const resultDistrictCode =
    result.address?.["ISO3166-2-lvl5"] ?? result.address?.["ISO3166-2-lvl4"];
  const districtMatch =
    districtText === "" ||
    (districtRule
      ? resultDistrictCode
        ? resultDistrictCode === districtRule.isoCode
        : textContainsAlias(text, districtRule.aliases)
      : text.includes(districtText));
  if (!districtMatch) return null;

  const streetTokens = significantStreetTokens(source.addressLine);
  const matchingStreetTokens = streetTokens.filter((token) => text.includes(token));
  const streetMatch =
    streetTokens.length > 0 &&
    matchingStreetTokens.length >= Math.min(2, streetTokens.length);
  const houseNumbers = sourceHouseNumbers(source.addressLine);
  const resultHouseNumber = normalizeGeocodingText(result.address?.house_number ?? "");
  const houseNumberMatch = resultHouseNumber !== "" && houseNumbers.includes(resultHouseNumber);
  const pharmacyMatch =
    (result.category === "amenity" || result.category === "shop") &&
    result.type === "pharmacy";

  let score = 0;
  const reasons: string[] = [];
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
    score += 2;
    reasons.push("house_number");
  }
  if (pharmacyMatch) {
    score += 2;
    reasons.push("pharmacy_poi");
  }
  reasons.push("country", "district");

  const high =
    (postcodeMatch && localityMatch && streetMatch && houseNumberMatch) ||
    (pharmacyMatch && postcodeMatch && localityMatch && (streetMatch || houseNumberMatch));
  const medium =
    (houseNumberMatch && streetMatch && (postcodeMatch || localityMatch)) ||
    (pharmacyMatch && (postcodeMatch || localityMatch) && (streetMatch || houseNumberMatch));

  return {
    result,
    latitude,
    longitude,
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

export function reconcileNominatimResults(
  source: GeocodingAddress,
  results: NominatimResult[],
): NominatimReconciliation {
  if (results.length === 0) {
    return { status: "failed", reason: "Provider returned no results." };
  }

  const candidates = results
    .map((result) => evaluateCandidate(source, result))
    .filter((candidate): candidate is CandidateEvaluation => candidate !== null)
    .sort(
      (left, right) =>
        right.score - left.score ||
        (right.result.importance ?? 0) - (left.result.importance ?? 0),
    );
  const best = candidates[0];

  if (!best?.quality) {
    return {
      status: "ambiguous",
      reason: "No result matched enough official postcode, locality, street, or house-number evidence.",
    };
  }

  const equallySupported = candidates.find(
    (candidate, index) =>
      index > 0 && candidate.score === best.score && coordinatesDiffer(candidate, best),
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
      resultIdentifier: `${best.result.osm_type}:${best.result.osm_id}`,
      displayName: best.result.display_name,
      quality: best.quality,
      reasons: best.reasons,
    },
  };
}
