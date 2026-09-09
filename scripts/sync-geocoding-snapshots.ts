import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  GOOGLE_COORDINATE_CACHE_DAYS,
  PAPHOS_DISPUTED_FALLBACK_REGISTRATION_NUMBERS,
  haversineDistanceMeters,
  isPaphosFallbackDisputed,
  isTrustedGoogleCoordinateCache,
  type GoogleMatchClassification,
  type GooglePlaceLinkRecord,
  type GooglePlaceLinkSnapshot,
  type GooglePlacesCacheRecord,
  type GooglePlacesCacheSnapshot,
} from "../lib/geocoding/google-places";
import type { GeocodingSnapshot } from "../lib/geocoding/snapshot";
import type {
  NormalizedOfficialImport,
  NormalizedOfficialPharmacy,
} from "../lib/ingestion/normalize";

const EXPECTED = {
  pharmacies: 90,
  exact: 81,
  probable: 3,
  ambiguous: 3,
  noMatch: 3,
  fallback: 28,
  fallbackOverlap: 25,
  fallbackExtension: 3,
  disputedFallbacks: 7,
  trustedFallbacks: 21,
  trustedFallbackOverlap: 18,
  trustedCoverage: 84,
  withoutTrustedCoordinates: 6,
  fallbackOnlyUnresolved: 69,
  materialDisagreements: 7,
  manualReview: 16,
} as const;

const DEFAULT_PATHS = {
  official: "data/official/cyprus-pharmacies-2026.json",
  googleLinks: "data/geocoding/paphos-google-place-links-2026.json",
  googleCache: "data/geocoding/cache/paphos-google-places.json",
  nominatim: "data/geocoding/paphos-nominatim-2026.json",
  geoapify: "data/geocoding/paphos-geoapify-2026.json",
} as const;

interface GoogleDatabaseRow {
  official_registration_number: string;
  place_id: string | null;
  display_name: null;
  formatted_address: null;
  latitude: number | null;
  longitude: number | null;
  google_phone_e164: null;
  classification: GoogleMatchClassification;
  matching_evidence: string[];
  retrieved_at: string;
  expires_at: string;
  updated_at: string;
}

interface PharmacyGeocodingUpdate {
  officialRegistrationNumber: string;
  latitude: number;
  longitude: number;
  geocodeProvider: string;
  geocodeResultIdentifier: string;
  geocodeQuery: string;
  geocodeQuality: "high" | "medium";
  geocodedAt: string;
}

interface ManualReviewRecord {
  registrationNumber: string;
  officialName: string;
  officialTextualAddress: string;
  officialPhone: string | null;
  googlePlaceId: string | null;
  googleCoordinates: { latitude: number; longitude: number } | null;
  fallbackProvider: string | null;
  fallbackCoordinates: { latitude: number; longitude: number } | null;
  distanceDisagreementMeters: number | null;
  googleClassification: GoogleMatchClassification;
  googleMatchingEvidence: string[];
  reviewReasons: Array<
    "material_coordinate_disagreement" | "non_exact_google_match"
  >;
}

export interface PaphosGeocodingSyncPlan {
  generatedAt: string;
  mode: "dry-run" | "write-supabase";
  counts: {
    paphosPharmacies: number;
    googleExact: number;
    googleProbable: number;
    googleAmbiguous: number;
    googleNoMatch: number;
    googleRows: number;
    freshExactGoogleCoordinates: number;
    acceptedFallbackArtifacts: number;
    disputedFallbacksExcluded: number;
    trustedFallbackRowsToPersist: number;
    trustedFallbackOverlapWithExactGoogle: number;
    trustedFallbackCoverageBeyondGoogle: number;
    currentTrustedLocationCoverage: number;
    currentUnresolved: number;
    fallbackOnlyTrustedLocationCoverage: number;
    fallbackOnlyUnresolved: number;
    materialDisagreementsOver250Meters: number;
    manualReview: number;
  };
  googleRows: GoogleDatabaseRow[];
  pharmacyGeocodingUpdates: PharmacyGeocodingUpdate[];
  manualReview: ManualReviewRecord[];
}

interface LoadedArtifacts {
  official: NormalizedOfficialImport;
  googleLinks: GooglePlaceLinkSnapshot;
  googleCache: GooglePlacesCacheSnapshot;
  nominatim: GeocodingSnapshot;
  geoapify: GeocodingSnapshot;
}

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Geocoding snapshot validation failed: ${message}`);
}

async function readJson<T>(filePath: string): Promise<T> {
  const absolutePath = path.resolve(process.cwd(), filePath);
  return JSON.parse(await readFile(absolutePath, "utf8")) as T;
}

async function loadArtifacts(): Promise<LoadedArtifacts> {
  const [official, googleLinks, googleCache, nominatim, geoapify] =
    await Promise.all([
      readJson<NormalizedOfficialImport>(DEFAULT_PATHS.official),
      readJson<GooglePlaceLinkSnapshot>(DEFAULT_PATHS.googleLinks),
      readJson<GooglePlacesCacheSnapshot>(DEFAULT_PATHS.googleCache),
      readJson<GeocodingSnapshot>(DEFAULT_PATHS.nominatim),
      readJson<GeocodingSnapshot>(DEFAULT_PATHS.geoapify),
    ]);
  return { official, googleLinks, googleCache, nominatim, geoapify };
}

function uniqueMap<T>(
  values: T[],
  keyFor: (value: T) => string,
  label: string,
): Map<string, T> {
  const result = new Map<string, T>();
  for (const value of values) {
    const key = keyFor(value);
    invariant(!result.has(key), `duplicate ${label} ${key}`);
    result.set(key, value);
  }
  return result;
}

function sameStrings(left: string[], right: string[]): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function officialAddress(pharmacy: NormalizedOfficialPharmacy): string {
  return [
    pharmacy.addressLine,
    pharmacy.addressAdditional,
    pharmacy.locality,
    pharmacy.postalCode,
    pharmacy.district,
    "Cyprus",
  ]
    .filter((part): part is string => Boolean(part))
    .join(", ");
}

function acceptedFallbacks(
  snapshots: GeocodingSnapshot[],
): PharmacyGeocodingUpdate[] {
  return snapshots.flatMap((snapshot) =>
    snapshot.records.flatMap((record) => {
      if (record.status !== "accepted" || !record.accepted) return [];
      invariant(
        record.accepted.quality === "high" || record.accepted.quality === "medium",
        `unsupported fallback quality for registration ${record.officialRegistrationNumber}`,
      );
      invariant(
        Number.isFinite(record.accepted.latitude) &&
          record.accepted.latitude >= -90 &&
          record.accepted.latitude <= 90 &&
          Number.isFinite(record.accepted.longitude) &&
          record.accepted.longitude >= -180 &&
          record.accepted.longitude <= 180,
        `invalid fallback coordinates for registration ${record.officialRegistrationNumber}`,
      );
      return [{
        officialRegistrationNumber: record.officialRegistrationNumber,
        latitude: record.accepted.latitude,
        longitude: record.accepted.longitude,
        geocodeProvider: snapshot.metadata.provider.id,
        geocodeResultIdentifier: record.accepted.resultIdentifier,
        geocodeQuery: record.query,
        geocodeQuality: record.accepted.quality,
        geocodedAt: record.attemptedAt,
      }];
    }),
  );
}

function classificationCounts(records: GooglePlaceLinkRecord[]) {
  return {
    exact: records.filter((record) => record.classification === "exact_identity_match").length,
    probable: records.filter((record) => record.classification === "probable_match").length,
    ambiguous: records.filter((record) => record.classification === "ambiguous").length,
    noMatch: records.filter((record) => record.classification === "no_match").length,
  };
}

function googleDatabaseRow(
  record: GooglePlacesCacheRecord,
  link: GooglePlaceLinkRecord,
  now: Date,
): GoogleDatabaseRow {
  const useCoordinates = isTrustedGoogleCoordinateCache(record, link, now);
  return {
    official_registration_number: record.officialRegistrationNumber,
    place_id: record.placeId,
    display_name: null,
    formatted_address: null,
    latitude: useCoordinates ? record.latitude : null,
    longitude: useCoordinates ? record.longitude : null,
    google_phone_e164: null,
    classification: record.classification,
    matching_evidence: record.matchingEvidence,
    retrieved_at: record.retrievedAt,
    expires_at: record.expiresAt,
    updated_at: now.toISOString(),
  };
}

export async function buildPaphosGeocodingSyncPlan(
  now = new Date(),
): Promise<PaphosGeocodingSyncPlan> {
  const artifacts = await loadArtifacts();
  const paphos = artifacts.official.pharmacies.filter(
    (pharmacy) => pharmacy.district === "Paphos",
  );
  const officialByRegistration = uniqueMap(
    paphos,
    (pharmacy) => pharmacy.officialRegistrationNumber,
    "official Paphos registration",
  );
  const linksByRegistration = uniqueMap(
    artifacts.googleLinks.records,
    (record) => record.officialRegistrationNumber,
    "Google link registration",
  );
  const cacheByRegistration = uniqueMap(
    artifacts.googleCache.records,
    (record) => record.officialRegistrationNumber,
    "Google cache registration",
  );

  invariant(paphos.length === EXPECTED.pharmacies, `expected 90 Paphos pharmacies, found ${paphos.length}`);
  invariant(linksByRegistration.size === paphos.length, "Google links do not cover all Paphos pharmacies");
  invariant(cacheByRegistration.size === paphos.length, "Google cache does not cover all Paphos pharmacies");
  invariant(artifacts.googleLinks.metadata.district === "Paphos", "Google link artifact is not Paphos-only");
  invariant(artifacts.googleCache.metadata.district === "Paphos", "Google cache artifact is not Paphos-only");

  const exactPlaceIds = new Set<string>();
  for (const pharmacy of paphos) {
    const registration = pharmacy.officialRegistrationNumber;
    const link = linksByRegistration.get(registration);
    const cache = cacheByRegistration.get(registration);
    invariant(link, `missing Google link for registration ${registration}`);
    invariant(cache, `missing Google cache for registration ${registration}`);
    invariant(link.placeId === cache.placeId, `Place ID mismatch for registration ${registration}`);
    invariant(link.classification === cache.classification, `classification mismatch for registration ${registration}`);
    invariant(link.retrievedAt === cache.retrievedAt, `retrieval timestamp mismatch for registration ${registration}`);
    invariant(sameStrings(link.matchingEvidence, cache.matchingEvidence), `evidence mismatch for registration ${registration}`);
    invariant(
      link.requiresManualReview ===
        (
          link.classification !== "exact_identity_match" ||
          (link.coordinateDifferenceMeters ?? 0) > 250
        ),
      `manual-review flag mismatch for registration ${registration}`,
    );
    invariant((cache.latitude === null) === (cache.longitude === null), `incomplete Google coordinate pair for registration ${registration}`);
    invariant(new Date(cache.expiresAt).getTime() > new Date(cache.retrievedAt).getTime(), `invalid Google expiry order for registration ${registration}`);
    invariant(
      new Date(cache.expiresAt).getTime() <=
        new Date(cache.retrievedAt).getTime() + GOOGLE_COORDINATE_CACHE_DAYS * 86_400_000,
      `Google cache exceeds 30 days for registration ${registration}`,
    );
    if (link.classification === "exact_identity_match") {
      invariant(link.placeId !== null, `exact match lacks Place ID for registration ${registration}`);
      invariant(cache.latitude !== null && cache.longitude !== null, `exact match lacks coordinates for registration ${registration}`);
      invariant(!exactPlaceIds.has(link.placeId), `duplicate exact Google Place ID ${link.placeId}`);
      exactPlaceIds.add(link.placeId);
    }
  }

  const classifications = classificationCounts(artifacts.googleLinks.records);
  invariant(classifications.exact === EXPECTED.exact, `expected 81 exact Google matches, found ${classifications.exact}`);
  invariant(classifications.probable === EXPECTED.probable, `expected 3 probable Google matches, found ${classifications.probable}`);
  invariant(classifications.ambiguous === EXPECTED.ambiguous, `expected 3 ambiguous Google matches, found ${classifications.ambiguous}`);
  invariant(classifications.noMatch === EXPECTED.noMatch, `expected 3 Google no-matches, found ${classifications.noMatch}`);
  const materialDisagreementRegistrations = artifacts.googleLinks.records
    .filter(
      (record) =>
        record.classification === "exact_identity_match" &&
        (record.coordinateDifferenceMeters ?? 0) > 250,
    )
    .map((record) => record.officialRegistrationNumber)
    .sort((left, right) => Number(left) - Number(right));
  invariant(
    sameStrings(
      materialDisagreementRegistrations,
      [...PAPHOS_DISPUTED_FALLBACK_REGISTRATION_NUMBERS],
    ),
    `material-disagreement registrations changed: ${materialDisagreementRegistrations.join(", ")}`,
  );

  const fallbacks = acceptedFallbacks([artifacts.nominatim, artifacts.geoapify]);
  const fallbackByRegistration = uniqueMap(
    fallbacks,
    (record) => record.officialRegistrationNumber,
    "accepted fallback registration",
  );
  invariant(fallbacks.length === EXPECTED.fallback, `expected 28 trusted fallback coordinates, found ${fallbacks.length}`);
  for (const fallback of fallbacks) {
    invariant(officialByRegistration.has(fallback.officialRegistrationNumber), `fallback registration ${fallback.officialRegistrationNumber} is outside official Paphos data`);
  }
  const disputedFallbacks = fallbacks.filter((record) =>
    isPaphosFallbackDisputed(record.officialRegistrationNumber),
  );
  const disputedRegistrations = disputedFallbacks
    .map((record) => record.officialRegistrationNumber)
    .sort((left, right) => Number(left) - Number(right));
  invariant(disputedFallbacks.length === EXPECTED.disputedFallbacks, `expected 7 disputed fallback coordinates, found ${disputedFallbacks.length}`);
  invariant(
    sameStrings(
      disputedRegistrations,
      [...PAPHOS_DISPUTED_FALLBACK_REGISTRATION_NUMBERS],
    ),
    `disputed fallback registrations changed: ${disputedRegistrations.join(", ")}`,
  );
  const trustedFallbacks = fallbacks.filter(
    (record) => !isPaphosFallbackDisputed(record.officialRegistrationNumber),
  );
  invariant(trustedFallbacks.length === EXPECTED.trustedFallbacks, `expected 21 trusted fallback coordinates, found ${trustedFallbacks.length}`);

  const exactRegistrations = new Set(
    artifacts.googleLinks.records
      .filter((record) => record.classification === "exact_identity_match")
      .map((record) => record.officialRegistrationNumber),
  );
  const overlap = fallbacks.filter((record) => exactRegistrations.has(record.officialRegistrationNumber)).length;
  const extension = fallbacks.length - overlap;
  const trustedFallbackOverlap = trustedFallbacks.filter((record) =>
    exactRegistrations.has(record.officialRegistrationNumber),
  ).length;
  const trustedFallbackExtension = trustedFallbacks.length - trustedFallbackOverlap;
  const artifactTrustedRegistrations = new Set([
    ...exactRegistrations,
    ...trustedFallbacks.map((record) => record.officialRegistrationNumber),
  ]);
  invariant(overlap === EXPECTED.fallbackOverlap, `expected 25 fallback/Google overlaps, found ${overlap}`);
  invariant(extension === EXPECTED.fallbackExtension, `expected 3 fallback coverage extensions, found ${extension}`);
  invariant(trustedFallbackOverlap === EXPECTED.trustedFallbackOverlap, `expected 18 trusted fallback/Google overlaps, found ${trustedFallbackOverlap}`);
  invariant(trustedFallbackExtension === EXPECTED.fallbackExtension, `expected 3 trusted fallback coverage extensions, found ${trustedFallbackExtension}`);
  invariant(artifactTrustedRegistrations.size === EXPECTED.trustedCoverage, `expected 84 artifact-backed trusted destinations, found ${artifactTrustedRegistrations.size}`);
  invariant(paphos.length - artifactTrustedRegistrations.size === EXPECTED.withoutTrustedCoordinates, `expected 6 artifact-level unresolved pharmacies, found ${paphos.length - artifactTrustedRegistrations.size}`);

  const googleRows = artifacts.googleCache.records.map((record) =>
    googleDatabaseRow(record, linksByRegistration.get(record.officialRegistrationNumber)!, now),
  );
  const freshGoogleRegistrations = new Set(
    googleRows
      .filter((row) => row.latitude !== null)
      .map((row) => row.official_registration_number),
  );
  const currentlyTrustedRegistrations = new Set([
    ...freshGoogleRegistrations,
    ...trustedFallbacks.map((record) => record.officialRegistrationNumber),
  ]);

  const manualReview = artifacts.googleLinks.records
    .filter(
      (link) =>
        link.classification !== "exact_identity_match" ||
        (link.coordinateDifferenceMeters ?? 0) > 250,
    )
    .map((link): ManualReviewRecord => {
      const pharmacy = officialByRegistration.get(link.officialRegistrationNumber)!;
      const cache = cacheByRegistration.get(link.officialRegistrationNumber)!;
      const fallback = fallbackByRegistration.get(link.officialRegistrationNumber) ?? null;
      const computedDifference =
        cache.latitude !== null && cache.longitude !== null && fallback
          ? haversineDistanceMeters(
              { latitude: cache.latitude, longitude: cache.longitude },
              { latitude: fallback.latitude, longitude: fallback.longitude },
            )
          : null;
      if (link.coordinateDifferenceMeters !== null) {
        invariant(computedDifference !== null, `missing comparison coordinate for registration ${link.officialRegistrationNumber}`);
        invariant(Math.abs(computedDifference - link.coordinateDifferenceMeters) < 1, `comparison distance mismatch for registration ${link.officialRegistrationNumber}`);
        invariant(link.comparedProvider === fallback?.geocodeProvider, `comparison provider mismatch for registration ${link.officialRegistrationNumber}`);
        invariant(link.comparedQuality === fallback?.geocodeQuality, `comparison quality mismatch for registration ${link.officialRegistrationNumber}`);
      }
      return {
        registrationNumber: link.officialRegistrationNumber,
        officialName: pharmacy.name,
        officialTextualAddress: officialAddress(pharmacy),
        officialPhone: pharmacy.phoneE164,
        googlePlaceId: link.placeId,
        googleCoordinates:
          cache.latitude !== null && cache.longitude !== null
            ? { latitude: cache.latitude, longitude: cache.longitude }
            : null,
        fallbackProvider: fallback?.geocodeProvider ?? null,
        fallbackCoordinates: fallback
          ? { latitude: fallback.latitude, longitude: fallback.longitude }
          : null,
        distanceDisagreementMeters: link.coordinateDifferenceMeters,
        googleClassification: link.classification,
        googleMatchingEvidence: link.matchingEvidence,
        reviewReasons: [
          ...(link.classification !== "exact_identity_match"
            ? ["non_exact_google_match" as const]
            : []),
          ...((link.coordinateDifferenceMeters ?? 0) > 250
            ? ["material_coordinate_disagreement" as const]
            : []),
        ],
      };
    })
    .sort((left, right) => Number(left.registrationNumber) - Number(right.registrationNumber));

  const materialDisagreements = manualReview.filter((record) =>
    record.reviewReasons.includes("material_coordinate_disagreement"),
  ).length;
  invariant(materialDisagreements === EXPECTED.materialDisagreements, `expected 7 material disagreements, found ${materialDisagreements}`);
  invariant(manualReview.length === EXPECTED.manualReview, `expected 16 manual-review records, found ${manualReview.length}`);

  const registration607 = manualReview.find((record) => record.registrationNumber === "607");
  invariant(registration607?.googleClassification === "exact_identity_match", "registration 607 is not an exact Google match");
  invariant(registration607.googleCoordinates?.latitude === 34.7565252, "registration 607 Google latitude changed");
  invariant(registration607.googleCoordinates?.longitude === 32.4164677, "registration 607 Google longitude changed");
  invariant(registration607.fallbackCoordinates?.latitude === 34.7490029, "registration 607 fallback latitude changed");
  invariant(registration607.fallbackCoordinates?.longitude === 32.4241615, "registration 607 fallback longitude changed");
  invariant(
    !trustedFallbacks.some(
      (record) => record.officialRegistrationNumber === "607",
    ),
    "registration 607 disputed fallback would be persisted as trusted",
  );

  return {
    generatedAt: now.toISOString(),
    mode: "dry-run",
    counts: {
      paphosPharmacies: paphos.length,
      googleExact: classifications.exact,
      googleProbable: classifications.probable,
      googleAmbiguous: classifications.ambiguous,
      googleNoMatch: classifications.noMatch,
      googleRows: googleRows.length,
      freshExactGoogleCoordinates: googleRows.filter((row) => row.latitude !== null).length,
      acceptedFallbackArtifacts: fallbacks.length,
      disputedFallbacksExcluded: disputedFallbacks.length,
      trustedFallbackRowsToPersist: trustedFallbacks.length,
      trustedFallbackOverlapWithExactGoogle: trustedFallbackOverlap,
      trustedFallbackCoverageBeyondGoogle: trustedFallbackExtension,
      currentTrustedLocationCoverage: currentlyTrustedRegistrations.size,
      currentUnresolved: paphos.length - currentlyTrustedRegistrations.size,
      fallbackOnlyTrustedLocationCoverage: trustedFallbacks.length,
      fallbackOnlyUnresolved: paphos.length - trustedFallbacks.length,
      materialDisagreementsOver250Meters: materialDisagreements,
      manualReview: manualReview.length,
    },
    googleRows,
    pharmacyGeocodingUpdates: trustedFallbacks,
    manualReview,
  };
}

async function writePlanToSupabase(plan: PaphosGeocodingSyncPlan): Promise<{
  googleRowsWritten: number;
  pharmacyRowsUpdated: number;
}> {
  const url = process.env.SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  invariant(url && secretKey, "--write-supabase requires SUPABASE_URL and SUPABASE_SECRET_KEY");
  const { createClient } = await import("@supabase/supabase-js");
  const client = createClient(url, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: officialRows, error: officialError } = await client
    .from("pharmacies")
    .select("official_registration_number")
    .eq("district", "Paphos");
  if (officialError) throw new Error(`Unable to verify Paphos pharmacies: ${officialError.message}`);
  const remoteRegistrations = new Set(
    (officialRows ?? []).map((row) => row.official_registration_number),
  );
  invariant(remoteRegistrations.size === EXPECTED.pharmacies, `expected 90 remote Paphos pharmacies, found ${remoteRegistrations.size}`);
  for (const row of plan.googleRows) {
    invariant(remoteRegistrations.has(row.official_registration_number), `Google row ${row.official_registration_number} is not a remote Paphos pharmacy`);
  }

  const { data: googleRows, error: googleError } = await client
    .from("pharmacy_google_places")
    .upsert(plan.googleRows, { onConflict: "official_registration_number" })
    .select("official_registration_number");
  if (googleError) throw new Error(`Unable to sync Google reconciliation: ${googleError.message}`);

  let pharmacyRowsUpdated = 0;
  for (const update of plan.pharmacyGeocodingUpdates) {
    const { data, error } = await client
      .from("pharmacies")
      .update({
        latitude: update.latitude,
        longitude: update.longitude,
        geocode_provider: update.geocodeProvider,
        geocode_result_identifier: update.geocodeResultIdentifier,
        geocode_query: update.geocodeQuery,
        geocode_quality: update.geocodeQuality,
        geocoded_at: update.geocodedAt,
      })
      .eq("district", "Paphos")
      .eq("official_registration_number", update.officialRegistrationNumber)
      .select("official_registration_number");
    if (error) {
      throw new Error(`Unable to sync fallback for registration ${update.officialRegistrationNumber}: ${error.message}`);
    }
    invariant(data?.length === 1, `fallback update did not match exactly one Paphos pharmacy ${update.officialRegistrationNumber}`);
    pharmacyRowsUpdated += 1;
  }

  return {
    googleRowsWritten: googleRows?.length ?? 0,
    pharmacyRowsUpdated,
  };
}

export async function runPaphosGeocodingSync(
  options: { writeSupabase?: boolean; now?: Date } = {},
) {
  const plan = await buildPaphosGeocodingSyncPlan(options.now);
  if (!options.writeSupabase) return { ...plan, writes: null };
  return {
    ...plan,
    mode: "write-supabase" as const,
    writes: await writePlanToSupabase(plan),
  };
}

async function main() {
  const writeSupabase = process.argv.slice(2).includes("--write-supabase");
  const unknown = process.argv.slice(2).filter((argument) => argument !== "--write-supabase");
  invariant(unknown.length === 0, `unknown arguments: ${unknown.join(", ")}`);
  const result = await runPaphosGeocodingSync({ writeSupabase });
  process.stdout.write(`${JSON.stringify({
    generatedAt: result.generatedAt,
    mode: result.mode,
    counts: result.counts,
    expectedSupabaseWrites: {
      googleReconciliationUpserts: result.googleRows.length,
      googleRowsWithFreshExactCoordinates: result.googleRows.filter(
        (row) => row.latitude !== null,
      ).length,
      trustedFallbackPharmacyUpdates: result.pharmacyGeocodingUpdates.length,
      officialIdentityAddressPhoneUpdates: 0,
    },
    manualReview: result.manualReview,
    writes: result.writes,
  }, null, 2)}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
