import type { Coordinates } from "../domain/types";
import type { NormalizedOfficialPharmacy } from "../ingestion/normalize";
import {
  coordinatesInBounds,
  geocodingHouseNumbers,
  geocodingLocalityAliases,
  normalizeGeocodingText,
  significantGeocodingStreetTokens,
  textContainsGeocodingAlias,
} from "./nominatim";
import { PAPHOS_DISTRICT_BOUNDS } from "./geoapify";

export const GOOGLE_PLACES_PROVIDER = "google_places";
export const GOOGLE_PLACES_ENDPOINT =
  "https://places.googleapis.com/v1/places:searchText";
export const GOOGLE_PLACES_FIELD_MASK = [
  "places.id",
  "places.displayName",
  "places.formattedAddress",
  "places.location",
  "places.nationalPhoneNumber",
  "places.internationalPhoneNumber",
].join(",");
export const GOOGLE_COORDINATE_CACHE_DAYS = 30;
export const GOOGLE_COORDINATE_REFRESH_AFTER_DAYS = 25;
export const PAPHOS_DISPUTED_FALLBACK_REGISTRATION_NUMBERS = [
  "413",
  "467",
  "607",
  "690",
  "869",
  "893",
  "1210",
] as const;

const paphosDisputedFallbackRegistrations = new Set<string>(
  PAPHOS_DISPUTED_FALLBACK_REGISTRATION_NUMBERS,
);

export function isPaphosFallbackDisputed(
  officialRegistrationNumber: string,
): boolean {
  return paphosDisputedFallbackRegistrations.has(officialRegistrationNumber);
}

export type GoogleMatchClassification =
  | "exact_identity_match"
  | "probable_match"
  | "ambiguous"
  | "no_match";

export interface GooglePlaceResult {
  id?: string;
  displayName?: { text?: string; languageCode?: string };
  formattedAddress?: string;
  location?: Coordinates;
  nationalPhoneNumber?: string;
  internationalPhoneNumber?: string;
}

export interface GooglePlacesResponse {
  places?: GooglePlaceResult[];
}

export interface GooglePlacesCacheRecord {
  officialRegistrationNumber: string;
  placeId: string | null;
  displayName: string | null;
  formattedAddress: string | null;
  latitude: number | null;
  longitude: number | null;
  googlePhoneE164: string | null;
  classification: GoogleMatchClassification;
  matchingEvidence: string[];
  retrievedAt: string;
  expiresAt: string;
}

export interface GooglePlacesCacheSnapshot {
  metadata: {
    schemaVersion: 1;
    generatedAt: string;
    contentExpiresAt: string;
    district: "Paphos";
    provider: typeof GOOGLE_PLACES_PROVIDER;
    endpoint: typeof GOOGLE_PLACES_ENDPOINT;
    fieldMask: typeof GOOGLE_PLACES_FIELD_MASK;
  };
  records: GooglePlacesCacheRecord[];
}

export interface GooglePlaceLinkRecord {
  officialRegistrationNumber: string;
  placeId: string | null;
  classification: GoogleMatchClassification;
  matchingEvidence: string[];
  retrievedAt: string;
  coordinateDifferenceMeters: number | null;
  comparedProvider: string | null;
  comparedQuality: string | null;
  requiresManualReview: boolean;
}

export interface GooglePlaceLinkSnapshot {
  metadata: {
    schemaVersion: 1;
    generatedAt: string;
    district: "Paphos";
    provider: typeof GOOGLE_PLACES_PROVIDER;
  };
  records: GooglePlaceLinkRecord[];
}

interface CandidateEvaluation {
  result: GooglePlaceResult;
  score: number;
  phoneMatch: boolean;
  conflictingPhone: boolean;
  coordinatesInPaphos: boolean;
  postcodeMatch: boolean;
  localityMatch: boolean;
  paphosAddress: boolean;
  houseNumberMatch: boolean;
  streetTokenMatches: number;
  nameTokenMatches: number;
  evidence: string[];
}

export type GooglePlacesReconciliation = {
  classification: GoogleMatchClassification;
  selected: GooglePlaceResult | null;
  matchingEvidence: string[];
  reason: string;
};

const DAY_MILLISECONDS = 24 * 60 * 60 * 1_000;

export function normalizeGooglePhone(value: string | null | undefined): string | null {
  if (!value) return null;
  let digits = value.replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.length === 8) digits = `357${digits}`;
  return digits.length >= 8 ? `+${digits}` : null;
}

export function buildGooglePhoneQuery(phoneE164: string): string {
  return phoneE164.replace(/^\+357/, "+357 ");
}

export function buildGoogleFallbackQuery(
  pharmacy: Pick<
    NormalizedOfficialPharmacy,
    "name" | "addressLine" | "locality" | "postalCode"
  >,
): string {
  return [
    pharmacy.addressLine,
    pharmacy.locality,
    pharmacy.postalCode,
    "Paphos",
    "Cyprus",
    "pharmacy",
    pharmacy.name,
  ]
    .filter(Boolean)
    .join(", ");
}

export function googleCacheExpiresAt(retrievedAt: string): string {
  return new Date(
    new Date(retrievedAt).getTime() + GOOGLE_COORDINATE_CACHE_DAYS * DAY_MILLISECONDS,
  ).toISOString();
}

export function googleCacheRefreshDueAt(retrievedAt: string): string {
  return new Date(
    new Date(retrievedAt).getTime() +
      GOOGLE_COORDINATE_REFRESH_AFTER_DAYS * DAY_MILLISECONDS,
  ).toISOString();
}

export function isGoogleCoordinateCacheUsable(
  record: GooglePlacesCacheRecord,
  now: Date,
): boolean {
  return (
    record.classification === "exact_identity_match" &&
    record.placeId !== null &&
    record.latitude !== null &&
    record.longitude !== null &&
    Number.isFinite(record.latitude) &&
    Number.isFinite(record.longitude) &&
    now.getTime() < new Date(record.expiresAt).getTime() &&
    new Date(record.expiresAt).getTime() <=
      new Date(record.retrievedAt).getTime() +
        GOOGLE_COORDINATE_CACHE_DAYS * DAY_MILLISECONDS
  );
}

export function isTrustedGoogleCoordinateCache(
  record: GooglePlacesCacheRecord,
  link: GooglePlaceLinkRecord | undefined,
  now: Date,
): boolean {
  return (
    link !== undefined &&
    link.officialRegistrationNumber === record.officialRegistrationNumber &&
    link.placeId === record.placeId &&
    link.classification === "exact_identity_match" &&
    isGoogleCoordinateCacheUsable(record, now)
  );
}

export function purgeExpiredGoogleContent(
  record: GooglePlacesCacheRecord,
  now: Date,
): GooglePlacesCacheRecord {
  if (now.getTime() < new Date(record.expiresAt).getTime()) return record;
  return {
    ...record,
    displayName: null,
    formattedAddress: null,
    latitude: null,
    longitude: null,
    googlePhoneE164: null,
  };
}

function transliterateGreek(value: string): string {
  const replacements: Array<[RegExp, string]> = [
    [/ου/g, "ou"],
    [/αι/g, "ai"],
    [/ει/g, "i"],
    [/οι/g, "i"],
    [/γγ/g, "ng"],
    [/γκ/g, "gk"],
    [/μπ/g, "b"],
    [/ντ/g, "d"],
  ];
  let normalized = normalizeGeocodingText(value);
  for (const [pattern, replacement] of replacements) {
    normalized = normalized.replace(pattern, replacement);
  }
  const characters: Record<string, string> = {
    α: "a", β: "v", γ: "g", δ: "d", ε: "e", ζ: "z", η: "i",
    θ: "th", ι: "i", κ: "k", λ: "l", μ: "m", ν: "n", ξ: "x",
    ο: "o", π: "p", ρ: "r", σ: "s", τ: "t", υ: "y", φ: "f",
    χ: "ch", ψ: "ps", ω: "o",
  };
  return [...normalized].map((character) => characters[character] ?? character).join("");
}

function identityTokens(value: string): string[] {
  return transliterateGreek(value)
    .split(" ")
    .map((token) => token.replace(/ph/g, "f").replace(/c/g, "k"))
    .filter((token) => token.length >= 4 && token !== "farmaky");
}

function similarToken(left: string, right: string): boolean {
  const consonants = (token: string) => token.replace(/[aeiouy]/g, "");
  return left === right ||
    (left.length >= 5 && right.length >= 5 && left.slice(0, 5) === right.slice(0, 5)) ||
    (
      left.length >= 5 &&
      right.length >= 5 &&
      consonants(left).length >= 2 &&
      consonants(left) === consonants(right)
    );
}

function countTokenMatches(source: string[], candidate: string[]): number {
  return source.filter((sourceToken) =>
    candidate.some((candidateToken) => similarToken(sourceToken, candidateToken)),
  ).length;
}

function evaluateCandidate(
  pharmacy: Pick<
    NormalizedOfficialPharmacy,
    "name" | "phoneE164" | "addressLine" | "locality" | "postalCode"
  >,
  result: GooglePlaceResult,
): CandidateEvaluation {
  const addressText = normalizeGeocodingText(result.formattedAddress ?? "");
  const candidateName = result.displayName?.text ?? "";
  const coordinates = result.location;
  const inPaphos =
    coordinates !== undefined &&
    coordinatesInBounds(
      coordinates.latitude,
      coordinates.longitude,
      PAPHOS_DISTRICT_BOUNDS,
    );
  const officialPhone = normalizeGooglePhone(pharmacy.phoneE164);
  const returnedPhones = [
    result.internationalPhoneNumber,
    result.nationalPhoneNumber,
  ]
    .map(normalizeGooglePhone)
    .filter((phone): phone is string => phone !== null);
  const phoneMatch = officialPhone !== null && returnedPhones.includes(officialPhone);
  const conflictingPhone =
    officialPhone !== null && returnedPhones.length > 0 && !phoneMatch;
  const postcodeMatch =
    pharmacy.postalCode !== null && addressText.includes(pharmacy.postalCode);
  const localityMatch = textContainsGeocodingAlias(
    addressText,
    geocodingLocalityAliases(pharmacy.locality),
  );
  const paphosAddress = textContainsGeocodingAlias(addressText, [
    "Paphos",
    "Pafos",
    "Πάφος",
    "Πάφου",
  ]);
  const houseNumberMatch = geocodingHouseNumbers(pharmacy.addressLine).some((number) =>
    addressText.split(" ").includes(number),
  );
  const streetTokenMatches = countTokenMatches(
    significantGeocodingStreetTokens(transliterateGreek(pharmacy.addressLine)),
    identityTokens(result.formattedAddress ?? ""),
  );
  const nameTokenMatches = countTokenMatches(
    identityTokens(pharmacy.name),
    identityTokens(candidateName),
  );
  const evidence = [
    ...(phoneMatch ? ["phone_exact"] : []),
    ...(conflictingPhone ? ["phone_conflict"] : []),
    ...(inPaphos ? ["coordinates_in_paphos"] : []),
    ...(paphosAddress ? ["paphos_address"] : []),
    ...(postcodeMatch ? ["postcode_exact"] : []),
    ...(localityMatch ? ["locality_compatible"] : []),
    ...(houseNumberMatch ? ["house_number_compatible"] : []),
    ...(streetTokenMatches > 0 ? [`street_tokens:${streetTokenMatches}`] : []),
    ...(nameTokenMatches > 0 ? [`name_tokens:${nameTokenMatches}`] : []),
  ];
  return {
    result,
    score:
      (phoneMatch ? 100 : 0) -
      (conflictingPhone ? 20 : 0) +
      (inPaphos ? 20 : 0) +
      (paphosAddress ? 5 : 0) +
      (postcodeMatch ? 15 : 0) +
      (localityMatch ? 10 : 0) +
      (houseNumberMatch ? 8 : 0) +
      Math.min(streetTokenMatches, 3) * 4 +
      Math.min(nameTokenMatches, 2) * 5,
    phoneMatch,
    conflictingPhone,
    coordinatesInPaphos: inPaphos,
    postcodeMatch,
    localityMatch,
    paphosAddress,
    houseNumberMatch,
    streetTokenMatches,
    nameTokenMatches,
    evidence,
  };
}

function candidateIdentity(result: GooglePlaceResult): string {
  return result.id ?? JSON.stringify(result.location ?? null);
}

export function reconcileGooglePlacesResults(
  pharmacy: Pick<
    NormalizedOfficialPharmacy,
    "name" | "phoneE164" | "addressLine" | "locality" | "postalCode"
  >,
  results: GooglePlaceResult[],
): GooglePlacesReconciliation {
  const uniqueResults = [...new Map(
    results.map((result) => [candidateIdentity(result), result]),
  ).values()];
  const candidates = uniqueResults
    .map((result) => evaluateCandidate(pharmacy, result))
    .sort((left, right) => right.score - left.score);
  const exactCandidates = candidates.filter(
    (candidate) =>
      candidate.phoneMatch &&
      candidate.coordinatesInPaphos &&
      (
        candidate.localityMatch ||
        candidate.postcodeMatch ||
        candidate.paphosAddress ||
        (candidate.houseNumberMatch && candidate.streetTokenMatches > 0)
      ),
  );

  if (exactCandidates.length === 1) {
    const exact = exactCandidates[0];
    return {
      classification: "exact_identity_match",
      selected: exact.result,
      matchingEvidence: exact.evidence,
      reason: "Exact normalized official phone and compatible Paphos location evidence.",
    };
  }
  if (exactCandidates.length > 1) {
    return {
      classification: "ambiguous",
      selected: exactCandidates[0].result,
      matchingEvidence: [
        ...exactCandidates[0].evidence,
        "multiple_exact_phone_candidates",
      ],
      reason: "Multiple Google Places candidates share the official phone and compatible Paphos evidence.",
    };
  }

  const best = candidates[0];
  if (!best || !best.coordinatesInPaphos || best.score < 30) {
    return {
      classification: "no_match",
      selected: null,
      matchingEvidence: best
        ? [...best.evidence, "insufficient_identity_evidence"]
        : ["no_candidates"],
      reason: "No Google Places candidate had sufficient phone or address identity evidence.",
    };
  }

  const strongAddressBusinessEvidence =
    best.coordinatesInPaphos &&
    (best.postcodeMatch || best.localityMatch) &&
    (best.houseNumberMatch || best.streetTokenMatches > 0) &&
    best.nameTokenMatches > 0;
  const phoneWithoutAddressEvidence =
    best.phoneMatch && best.coordinatesInPaphos;
  const runnerUp = candidates[1];
  const uniquelySupported = !runnerUp || best.score - runnerUp.score >= 10;

  if ((strongAddressBusinessEvidence || phoneWithoutAddressEvidence) && uniquelySupported) {
    return {
      classification: "probable_match",
      selected: best.result,
      matchingEvidence: best.evidence,
      reason: phoneWithoutAddressEvidence
        ? "Official phone matched, but specific address/locality evidence was incomplete."
        : "Unique candidate had strong address and business-name evidence without an exact official phone match.",
    };
  }

  return {
    classification: "ambiguous",
    selected: best.result,
    matchingEvidence: best.evidence,
    reason: "One or more candidates were plausible, but identity evidence was incomplete or conflicting.",
  };
}

export function googleCacheRecord(
  officialRegistrationNumber: string,
  reconciliation: GooglePlacesReconciliation,
  retrievedAt: string,
): GooglePlacesCacheRecord {
  const selected = reconciliation.selected;
  const coordinates = selected?.location;
  return {
    officialRegistrationNumber,
    placeId: selected?.id ?? null,
    displayName: selected?.displayName?.text ?? null,
    formattedAddress: selected?.formattedAddress ?? null,
    latitude: coordinates?.latitude ?? null,
    longitude: coordinates?.longitude ?? null,
    googlePhoneE164:
      normalizeGooglePhone(selected?.internationalPhoneNumber) ??
      normalizeGooglePhone(selected?.nationalPhoneNumber),
    classification: reconciliation.classification,
    matchingEvidence: reconciliation.matchingEvidence,
    retrievedAt,
    expiresAt: googleCacheExpiresAt(retrievedAt),
  };
}

export function rejectDuplicateTrustedGooglePlaceIds(
  records: GooglePlacesCacheRecord[],
): GooglePlacesCacheRecord[] {
  const trustedCounts = new Map<string, number>();
  for (const record of records) {
    if (
      record.placeId &&
      (record.classification === "exact_identity_match" ||
        record.classification === "probable_match")
    ) {
      trustedCounts.set(record.placeId, (trustedCounts.get(record.placeId) ?? 0) + 1);
    }
  }
  return records.map((record) => {
    if (!record.placeId || (trustedCounts.get(record.placeId) ?? 0) < 2) return record;
    return {
      ...record,
      classification: "ambiguous",
      matchingEvidence: [...record.matchingEvidence, "duplicate_place_id"],
    };
  });
}

export function haversineDistanceMeters(
  from: Coordinates,
  to: Coordinates,
): number {
  const radians = (degrees: number) => (degrees * Math.PI) / 180;
  const latitude1 = radians(from.latitude);
  const latitude2 = radians(to.latitude);
  const latitudeDifference = radians(to.latitude - from.latitude);
  const longitudeDifference = radians(to.longitude - from.longitude);
  const calculation =
    Math.sin(latitudeDifference / 2) ** 2 +
    Math.cos(latitude1) *
      Math.cos(latitude2) *
      Math.sin(longitudeDifference / 2) ** 2;
  return (
    6_371_000 *
    2 *
    Math.atan2(Math.sqrt(calculation), Math.sqrt(1 - calculation))
  );
}
