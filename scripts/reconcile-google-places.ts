import nextEnv from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import geoapifySnapshotJson from "../data/geocoding/paphos-geoapify-2026.json";
import nominatimSnapshotJson from "../data/geocoding/paphos-nominatim-2026.json";
import officialSnapshotJson from "../data/official/cyprus-pharmacies-2026.json";
import {
  GOOGLE_COORDINATE_REFRESH_AFTER_DAYS,
  GOOGLE_PLACE_DETAILS_ENDPOINT,
  GOOGLE_PLACE_DETAILS_FIELD_MASK,
  GOOGLE_PLACES_ENDPOINT,
  GOOGLE_PLACES_FIELD_MASK,
  GOOGLE_PLACES_PROVIDER,
  buildGoogleFallbackQuery,
  buildGooglePhoneQuery,
  googleCacheRecord,
  googleCacheRefreshDueAt,
  haversineDistanceMeters,
  isGoogleCoordinateCacheUsable,
  purgeExpiredGoogleContent,
  reconcileGooglePlacesResults,
  rejectDuplicateTrustedGooglePlaceIds,
  type GooglePlaceLinkRecord,
  type GooglePlaceLinkSnapshot,
  type GooglePlaceResult,
  type GooglePlacesCacheRecord,
  type GooglePlacesCacheSnapshot,
  type GooglePlacesResponse,
} from "../lib/geocoding/google-places";
import type { GeocodingSnapshot } from "../lib/geocoding/snapshot";
import type {
  NormalizedOfficialImport,
} from "../lib/ingestion/normalize";

nextEnv.loadEnvConfig(process.cwd());

const REQUEST_INTERVAL_MILLISECONDS = 100;
const DEFAULT_CACHE_PATH = "data/geocoding/cache/paphos-google-places.json";
const DEFAULT_LINKS_PATH = "data/geocoding/paphos-google-place-links-2026.json";
const MATERIAL_DISAGREEMENT_METERS = 250;
const REPLACEMENT_PLACE_CANDIDATES = new Map([
  [
    "1430",
    {
      previousRegistration: "1280",
      placeId: "ChIJmQggJdAH5xQRL2KIf4Ll3mE",
    },
  ],
  [
    "1439",
    {
      previousRegistration: "1332",
      placeId: "ChIJGcWVHYUH5xQRG3s6wPkBEsk",
    },
  ],
]);

const officialSnapshot =
  officialSnapshotJson as unknown as NormalizedOfficialImport & {
    metadata: { generatedAt: string };
  };
const nominatimSnapshot =
  nominatimSnapshotJson as unknown as GeocodingSnapshot;
const geoapifySnapshot =
  geoapifySnapshotJson as unknown as GeocodingSnapshot;

interface CliOptions {
  cachePath: string;
  linksPath: string;
  benchmarkPath: string | null;
  refresh: boolean;
  writeSupabase: boolean;
  purgeExpired: boolean;
}

interface BenchmarkCandidate {
  id: string | null;
  displayName: string | null;
  formattedAddress: string | null;
  latitude: number | null;
  longitude: number | null;
  nationalPhoneNumber: string | null;
  internationalPhoneNumber: string | null;
}

interface BenchmarkSnapshot {
  generatedAt: string;
  records: Array<{
    registration: string;
    candidates: BenchmarkCandidate[];
  }>;
}

interface ExistingCoordinate {
  provider: string;
  quality: string;
  latitude: number;
  longitude: number;
}

function optionValue(
  arguments_: string[],
  name: string,
  fallback: string | null,
): string | null {
  const index = arguments_.indexOf(name);
  return index >= 0 ? arguments_[index + 1] ?? fallback : fallback;
}

function parseOptions(arguments_: string[]): CliOptions {
  return {
    cachePath: optionValue(arguments_, "--cache", DEFAULT_CACHE_PATH)!,
    linksPath: optionValue(arguments_, "--links", DEFAULT_LINKS_PATH)!,
    benchmarkPath: optionValue(arguments_, "--benchmark", null),
    refresh: arguments_.includes("--refresh"),
    writeSupabase: arguments_.includes("--write-supabase"),
    purgeExpired: arguments_.includes("--purge-expired"),
  };
}

async function readJsonIfPresent<T>(filePath: string | null): Promise<T | null> {
  if (!filePath) return null;
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function fetchGooglePlaces(
  textQuery: string,
  apiKey: string,
): Promise<GooglePlaceResult[]> {
  const response = await fetch(GOOGLE_PLACES_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": GOOGLE_PLACES_FIELD_MASK,
    },
    body: JSON.stringify({
      textQuery,
      regionCode: "CY",
      languageCode: "en",
      pageSize: 3,
      locationBias: {
        circle: {
          center: { latitude: 34.82, longitude: 32.43 },
          radius: 50_000,
        },
      },
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    throw new Error(`Google Places request failed with HTTP ${response.status}.`);
  }
  return ((await response.json()) as GooglePlacesResponse).places ?? [];
}

async function fetchGooglePlaceDetails(
  placeId: string,
  apiKey: string,
): Promise<GooglePlaceResult | null> {
  const response = await fetch(
    `${GOOGLE_PLACE_DETAILS_ENDPOINT}/${encodeURIComponent(placeId)}`,
    {
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": GOOGLE_PLACE_DETAILS_FIELD_MASK,
      },
      signal: AbortSignal.timeout(15_000),
    },
  );
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(`Google Place Details request failed with HTTP ${response.status}.`);
  }
  return (await response.json()) as GooglePlaceResult;
}

function createCacheSnapshot(
  records: GooglePlacesCacheRecord[],
): GooglePlacesCacheSnapshot {
  const generatedAt = records.reduce(
    (latest, record) => (record.retrievedAt > latest ? record.retrievedAt : latest),
    officialSnapshot.metadata.generatedAt,
  );
  const recordsWithCachedContent = records.filter(
    (record) =>
      record.displayName !== null ||
      record.formattedAddress !== null ||
      record.latitude !== null ||
      record.longitude !== null ||
      record.googlePhoneE164 !== null,
  );
  const contentExpiresAt = recordsWithCachedContent.reduce(
    (earliest, record) =>
      earliest === "" || record.expiresAt < earliest ? record.expiresAt : earliest,
    "",
  );
  return {
    metadata: {
      schemaVersion: 1,
      generatedAt,
      contentExpiresAt,
      district: "Paphos",
      provider: GOOGLE_PLACES_PROVIDER,
      endpoint: GOOGLE_PLACES_ENDPOINT,
      fieldMask: GOOGLE_PLACES_FIELD_MASK,
    },
    records,
  };
}

async function saveCache(
  cachePath: string,
  records: GooglePlacesCacheRecord[],
): Promise<GooglePlacesCacheSnapshot> {
  const snapshot = createCacheSnapshot(records);
  await mkdir(path.dirname(cachePath), { recursive: true });
  await writeFile(cachePath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
  return snapshot;
}

function benchmarkPlaces(candidate: BenchmarkCandidate): GooglePlaceResult {
  return {
    id: candidate.id ?? undefined,
    displayName: candidate.displayName
      ? { text: candidate.displayName }
      : undefined,
    formattedAddress: candidate.formattedAddress ?? undefined,
    location:
      candidate.latitude !== null && candidate.longitude !== null
        ? { latitude: candidate.latitude, longitude: candidate.longitude }
        : undefined,
    nationalPhoneNumber: candidate.nationalPhoneNumber ?? undefined,
    internationalPhoneNumber: candidate.internationalPhoneNumber ?? undefined,
  };
}

function cachedPlace(record: GooglePlacesCacheRecord): GooglePlaceResult | null {
  if (
    !record.placeId ||
    !record.displayName ||
    !record.formattedAddress ||
    record.latitude === null ||
    record.longitude === null
  ) {
    return null;
  }
  return {
    id: record.placeId,
    displayName: { text: record.displayName },
    formattedAddress: record.formattedAddress,
    location: {
      latitude: record.latitude,
      longitude: record.longitude,
    },
    internationalPhoneNumber: record.googlePhoneE164 ?? undefined,
  };
}

function currentCoordinates(): Map<string, ExistingCoordinate> {
  const coordinates = new Map<string, ExistingCoordinate>();
  for (const [snapshot, provider] of [
    [nominatimSnapshot, "openstreetmap_nominatim"],
    [geoapifySnapshot, "geoapify"],
  ] as const) {
    for (const record of snapshot.records) {
      if (record.status !== "accepted" || !record.accepted) continue;
      coordinates.set(record.officialRegistrationNumber, {
        provider,
        quality: record.accepted.quality,
        latitude: record.accepted.latitude,
        longitude: record.accepted.longitude,
      });
    }
  }
  return coordinates;
}

function buildLongLivedLinks(
  records: GooglePlacesCacheRecord[],
  activeRegistrations: Set<string>,
  previousLinks: GooglePlaceLinkSnapshot | null,
) {
  const existingCoordinates = currentCoordinates();
  const previousLinksByRegistration = new Map(
    (previousLinks?.records ?? []).map((record) => [
      record.officialRegistrationNumber,
      record,
    ]),
  );
  const linkRecords: GooglePlaceLinkRecord[] = records.map((record) => {
    if (!activeRegistrations.has(record.officialRegistrationNumber)) {
      const historicalLink = previousLinksByRegistration.get(
        record.officialRegistrationNumber,
      );
      if (historicalLink) return historicalLink;
    }
    const existing = existingCoordinates.get(record.officialRegistrationNumber);
    const coordinateDifferenceMeters =
      record.classification === "exact_identity_match" &&
      record.latitude !== null &&
      record.longitude !== null &&
      existing
        ? Math.round(
            haversineDistanceMeters(
              { latitude: existing.latitude, longitude: existing.longitude },
              { latitude: record.latitude, longitude: record.longitude },
            ),
          )
        : null;
    return {
      officialRegistrationNumber: record.officialRegistrationNumber,
      placeId: record.placeId,
      classification: record.classification,
      matchingEvidence: record.matchingEvidence,
      retrievedAt: record.retrievedAt,
      coordinateDifferenceMeters,
      comparedProvider: existing?.provider ?? null,
      comparedQuality: existing?.quality ?? null,
      requiresManualReview:
        record.classification !== "exact_identity_match" ||
        (coordinateDifferenceMeters ?? 0) > MATERIAL_DISAGREEMENT_METERS,
    };
  });
  const exact = linkRecords.filter(
    (record) => record.classification === "exact_identity_match",
  ).length;
  const probable = linkRecords.filter(
    (record) => record.classification === "probable_match",
  ).length;
  const ambiguous = linkRecords.filter(
    (record) => record.classification === "ambiguous",
  ).length;
  const noMatch = linkRecords.filter(
    (record) => record.classification === "no_match",
  ).length;
  const activeRecords = linkRecords.filter((record) =>
    activeRegistrations.has(record.officialRegistrationNumber),
  );
  const disagreementsOver250Meters = linkRecords
    .filter((record) => (record.coordinateDifferenceMeters ?? 0) > MATERIAL_DISAGREEMENT_METERS)
    .map((record) => ({
      officialRegistrationNumber: record.officialRegistrationNumber,
      distanceMeters: record.coordinateDifferenceMeters!,
      comparedProvider: record.comparedProvider!,
      comparedQuality: record.comparedQuality!,
    }));
  return {
    metadata: {
      schemaVersion: 1,
      generatedAt: linkRecords.reduce(
        (latest, record) => (record.retrievedAt > latest ? record.retrievedAt : latest),
        officialSnapshot.metadata.generatedAt,
      ),
      district: "Paphos",
      sourceSnapshot: "data/official/cyprus-pharmacies-2026.json",
      sourceSnapshotGeneratedAt: officialSnapshot.metadata.generatedAt,
      provider: GOOGLE_PLACES_PROVIDER,
      policyUrl: "https://developers.google.com/maps/documentation/places/web-service/policies",
      note: "Place IDs may be retained. Google response content and coordinates are stored only in the expiring cache, not this artifact.",
    },
    report: {
      total: linkRecords.length,
      exact,
      probable,
      ambiguous,
      noMatch,
      trustedGoogleCoordinates: exact,
      trustedGoogleCoordinatePercentage: Number(
        ((exact / linkRecords.length) * 100).toFixed(1),
      ),
      materialDisagreementThresholdMeters: MATERIAL_DISAGREEMENT_METERS,
      disagreementsOver250Meters,
      manualReviewCount: linkRecords.filter((record) => record.requiresManualReview).length,
      activeTotal: activeRecords.length,
      activeExact: activeRecords.filter(
        (record) => record.classification === "exact_identity_match",
      ).length,
      activeProbable: activeRecords.filter(
        (record) => record.classification === "probable_match",
      ).length,
      activeAmbiguous: activeRecords.filter(
        (record) => record.classification === "ambiguous",
      ).length,
      activeNoMatch: activeRecords.filter(
        (record) => record.classification === "no_match",
      ).length,
      historicalCount: linkRecords.length - activeRecords.length,
    },
    records: linkRecords,
  };
}

async function saveLinks(
  linksPath: string,
  records: GooglePlacesCacheRecord[],
  activeRegistrations: Set<string>,
  previousLinks: GooglePlaceLinkSnapshot | null,
): Promise<ReturnType<typeof buildLongLivedLinks>> {
  const links = buildLongLivedLinks(
    records,
    activeRegistrations,
    previousLinks,
  );
  await mkdir(path.dirname(linksPath), { recursive: true });
  await writeFile(linksPath, `${JSON.stringify(links, null, 2)}\n`, "utf8");
  return links;
}

async function writeCacheToSupabase(
  records: GooglePlacesCacheRecord[],
  now: Date,
): Promise<number> {
  const url = process.env.SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  if (!url || !secretKey) {
    throw new Error(
      "--write-supabase requires SUPABASE_URL and SUPABASE_SECRET_KEY in the local environment.",
    );
  }
  const client = createClient(url, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error: purgeError } = await client
    .from("pharmacy_google_places")
    .update({
      display_name: null,
      formatted_address: null,
      latitude: null,
      longitude: null,
      google_phone_e164: null,
      updated_at: now.toISOString(),
    })
    .lte("expires_at", now.toISOString());
  if (purgeError) {
    throw new Error(`Unable to clear expired Google content: ${purgeError.message}`);
  }

  const rows = records.map((record) => {
    const useCoordinates = isGoogleCoordinateCacheUsable(record, now);
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
  });
  const { data, error } = await client
    .from("pharmacy_google_places")
    .upsert(rows, { onConflict: "official_registration_number" })
    .select("official_registration_number");
  if (error) {
    throw new Error(`Unable to write Google Places cache: ${error.message}`);
  }
  return data?.length ?? 0;
}

async function main() {
  const options = parseOptions(process.argv.slice(2));
  const now = new Date();
  if (options.purgeExpired) {
    const previous = await readJsonIfPresent<GooglePlacesCacheSnapshot>(
      options.cachePath,
    );
    if (!previous) {
      throw new Error(`Google Places cache not found at ${options.cachePath}.`);
    }
    const records = previous.records.map((record) =>
      purgeExpiredGoogleContent(record, now),
    );
    const purged = records.filter(
      (record, index) =>
        record.latitude === null && previous.records[index].latitude !== null,
    ).length;
    await saveCache(options.cachePath, records);
    const databaseRowsUpdated = options.writeSupabase
      ? await writeCacheToSupabase(records, now)
      : null;
    process.stdout.write(
      `${JSON.stringify(
        {
          cachePath: options.cachePath,
          expiredRecordsPurged: purged,
          databaseRowsUpdated,
        },
        null,
        2,
      )}\n`,
    );
    return;
  }

  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) {
    throw new Error(
      "GOOGLE_PLACES_API_KEY is required in the local environment or .env.local.",
    );
  }
  const placesApiKey = apiKey;
  const selected = officialSnapshot.pharmacies.filter(
    (pharmacy) => pharmacy.district === "Paphos",
  );
  if (selected.length !== 92) {
    throw new Error(`Expected exactly 92 active Paphos pharmacies, found ${selected.length}.`);
  }
  const activeRegistrations = new Set(
    selected.map((pharmacy) => pharmacy.officialRegistrationNumber),
  );
  const previous = await readJsonIfPresent<GooglePlacesCacheSnapshot>(options.cachePath);
  const previousLinks = await readJsonIfPresent<GooglePlaceLinkSnapshot>(
    options.linksPath,
  );
  const previousByRegistration = new Map(
    (previous?.records ?? []).map((record) => [record.officialRegistrationNumber, record]),
  );
  const benchmark = await readJsonIfPresent<BenchmarkSnapshot>(options.benchmarkPath);
  const benchmarkByRegistration = new Map(
    (benchmark?.records ?? []).map((record) => [record.registration, record]),
  );
  const records: GooglePlacesCacheRecord[] = [];
  let detailsRequests = 0;
  let textSearchRequests = 0;
  let reusedCache = 0;
  let reusedBenchmark = 0;
  let lastRequestAt = 0;
  const invalidPlaceIds: Array<{
    officialRegistrationNumber: string;
    placeId: string;
  }> = [];
  const changedPlaceIds: Array<{
    officialRegistrationNumber: string;
    previousPlaceId: string;
    currentPlaceId: string | null;
  }> = [];

  async function providerSearch(query: string): Promise<GooglePlaceResult[]> {
    const waitFor = REQUEST_INTERVAL_MILLISECONDS - (Date.now() - lastRequestAt);
    if (waitFor > 0) await delay(waitFor);
    try {
      textSearchRequests += 1;
      return await fetchGooglePlaces(query, placesApiKey);
    } finally {
      lastRequestAt = Date.now();
    }
  }

  async function providerDetails(
    officialRegistrationNumber: string,
    placeId: string,
  ): Promise<GooglePlaceResult | null> {
    const waitFor = REQUEST_INTERVAL_MILLISECONDS - (Date.now() - lastRequestAt);
    if (waitFor > 0) await delay(waitFor);
    try {
      detailsRequests += 1;
      const result = await fetchGooglePlaceDetails(placeId, placesApiKey);
      if (!result) {
        invalidPlaceIds.push({ officialRegistrationNumber, placeId });
      }
      return result;
    } finally {
      lastRequestAt = Date.now();
    }
  }

  async function searchForPharmacy(
    pharmacy: (typeof selected)[number],
  ): Promise<GooglePlaceResult[]> {
    if (!pharmacy.phoneE164) {
      return providerSearch(buildGoogleFallbackQuery(pharmacy));
    }
    const phoneResults = await providerSearch(
      buildGooglePhoneQuery(pharmacy.phoneE164),
    );
    const reconciliation = reconcileGooglePlacesResults(pharmacy, phoneResults);
    if (reconciliation.classification === "exact_identity_match") {
      return phoneResults;
    }
    const fallbackResults = await providerSearch(buildGoogleFallbackQuery(pharmacy));
    return [...phoneResults, ...fallbackResults];
  }

  for (const [index, pharmacy] of selected.entries()) {
    const previousRecord = previousByRegistration.get(
      pharmacy.officialRegistrationNumber,
    );
    let record: GooglePlacesCacheRecord;
    if (
      !options.refresh &&
      previousRecord &&
      now < new Date(googleCacheRefreshDueAt(previousRecord.retrievedAt))
    ) {
      record = previousRecord;
      const cachedResult = cachedPlace(previousRecord);
      if (previousRecord.classification === "probable_match" && cachedResult) {
        const reclassified = reconcileGooglePlacesResults(pharmacy, [cachedResult]);
        if (reclassified.classification === "exact_identity_match") {
          record = googleCacheRecord(
            pharmacy.officialRegistrationNumber,
            reclassified,
            previousRecord.retrievedAt,
          );
        }
      }
      if (
        record.classification === "no_match" &&
        record.matchingEvidence.length === 0
      ) {
        record = {
          ...record,
          matchingEvidence: ["no_accepted_candidate"],
        };
      }
      if (
        record.classification === "ambiguous" &&
        record.matchingEvidence.includes("phone_exact") &&
        !record.matchingEvidence.includes("multiple_exact_phone_candidates")
      ) {
        record = {
          ...record,
          matchingEvidence: [
            ...record.matchingEvidence,
            "multiple_exact_phone_candidates",
          ],
        };
      }
      reusedCache += 1;
    } else {
      const benchmarkRecord = !options.refresh
        ? benchmarkByRegistration.get(pharmacy.officialRegistrationNumber)
        : null;
      let retrievedAt: string;
      let reconciliation;
      if (benchmarkRecord && benchmark) {
        const results = benchmarkRecord.candidates.map(benchmarkPlaces);
        reconciliation = reconcileGooglePlacesResults(pharmacy, results);
        retrievedAt = benchmark.generatedAt;
        reusedBenchmark += 1;
      } else {
        const replacementCandidate = REPLACEMENT_PLACE_CANDIDATES.get(
          pharmacy.officialRegistrationNumber,
        );
        const candidatePlaceId =
          previousRecord?.placeId ?? replacementCandidate?.placeId ?? null;
        const details = candidatePlaceId
          ? await providerDetails(
              pharmacy.officialRegistrationNumber,
              candidatePlaceId,
            )
          : null;
        retrievedAt = new Date().toISOString();
        if (details) {
          reconciliation = reconcileGooglePlacesResults(pharmacy, [details]);
          if (
            previousRecord?.classification === "ambiguous" &&
            reconciliation.classification === "exact_identity_match"
          ) {
            reconciliation = {
              ...reconciliation,
              classification: "ambiguous" as const,
              matchingEvidence: [
                ...previousRecord.matchingEvidence,
                "Current Place Details still supports this candidate, but the prior multiple-candidate ambiguity remains unresolved.",
              ],
              reason:
                "Place Details verified the candidate but cannot by itself resolve the previous multiple-candidate ambiguity.",
            };
          }
          if (replacementCandidate) {
            const replacementEvidence =
              reconciliation.classification === "exact_identity_match"
                ? `Existing Place ID from prior registration ${replacementCandidate.previousRegistration}; verified the same official phone and physical address for replacement registration ${pharmacy.officialRegistrationNumber}.`
                : `Existing Place ID from prior registration ${replacementCandidate.previousRegistration} was checked for replacement registration ${pharmacy.officialRegistrationNumber}, but exact identity was not established.`;
            reconciliation = {
              ...reconciliation,
              matchingEvidence: [
                ...reconciliation.matchingEvidence,
                replacementEvidence,
              ],
            };
          }
          if (reconciliation.classification === "no_match") {
            const results = await searchForPharmacy(pharmacy);
            reconciliation = reconcileGooglePlacesResults(pharmacy, results);
          }
        } else {
          const results = await searchForPharmacy(pharmacy);
          reconciliation = reconcileGooglePlacesResults(pharmacy, results);
        }
      }
      record = googleCacheRecord(
        pharmacy.officialRegistrationNumber,
        reconciliation,
        retrievedAt,
      );
      if (
        previousRecord?.placeId &&
        previousRecord.placeId !== record.placeId
      ) {
        changedPlaceIds.push({
          officialRegistrationNumber: pharmacy.officialRegistrationNumber,
          previousPlaceId: previousRecord.placeId,
          currentPlaceId: record.placeId,
        });
      }
    }
    records.push(record);
    await saveCache(options.cachePath, records);
    process.stdout.write(
      `[${index + 1}/${selected.length}] ${pharmacy.officialRegistrationNumber} ${record.classification}\n`,
    );
  }

  const reconciledRecords = rejectDuplicateTrustedGooglePlaceIds(records);
  const historicalRecords = (previous?.records ?? [])
    .filter(
      (record) => !activeRegistrations.has(record.officialRegistrationNumber),
    )
    .map((record) => purgeExpiredGoogleContent(record, now));
  const allRecords = [...historicalRecords, ...reconciledRecords].sort((left, right) =>
    left.officialRegistrationNumber.localeCompare(
      right.officialRegistrationNumber,
      "en",
      { numeric: true },
    ),
  );
  const cache = await saveCache(options.cachePath, allRecords);
  const links = await saveLinks(
    options.linksPath,
    allRecords,
    activeRegistrations,
    previousLinks,
  );
  const databaseRowsUpdated = options.writeSupabase
    ? await writeCacheToSupabase(reconciledRecords, now)
    : null;
  process.stdout.write(
    `${JSON.stringify(
      {
        cachePath: options.cachePath,
        linksPath: options.linksPath,
        refreshDueAfterDays: GOOGLE_COORDINATE_REFRESH_AFTER_DAYS,
        cacheExpiresAt: cache.metadata.contentExpiresAt,
        apiRequests: detailsRequests + textSearchRequests,
        detailsRequests,
        textSearchRequests,
        reusedCache,
        reusedBenchmark,
        historicalRecordsPreserved: historicalRecords.length,
        invalidPlaceIds,
        changedPlaceIds,
        ...links.report,
        databaseRowsUpdated,
      },
      null,
      2,
    )}\n`,
  );
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
