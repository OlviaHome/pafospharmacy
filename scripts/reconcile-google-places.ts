import nextEnv from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import geoapifySnapshotJson from "../data/geocoding/paphos-geoapify-2026.json";
import nominatimSnapshotJson from "../data/geocoding/paphos-nominatim-2026.json";
import officialSnapshotJson from "../data/official/cyprus-pharmacies-2026.json";
import {
  GOOGLE_COORDINATE_REFRESH_AFTER_DAYS,
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

function createCacheSnapshot(
  records: GooglePlacesCacheRecord[],
): GooglePlacesCacheSnapshot {
  const generatedAt = records.reduce(
    (latest, record) => (record.retrievedAt > latest ? record.retrievedAt : latest),
    officialSnapshot.metadata.generatedAt,
  );
  const contentExpiresAt = records.reduce(
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

function buildLongLivedLinks(records: GooglePlacesCacheRecord[]) {
  const existingCoordinates = currentCoordinates();
  const linkRecords: GooglePlaceLinkRecord[] = records.map((record) => {
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
    },
    records: linkRecords,
  };
}

async function saveLinks(
  linksPath: string,
  records: GooglePlacesCacheRecord[],
): Promise<ReturnType<typeof buildLongLivedLinks>> {
  const links = buildLongLivedLinks(records);
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
  if (selected.length !== 90) {
    throw new Error(`Expected exactly 90 official Paphos pharmacies, found ${selected.length}.`);
  }
  const previous = await readJsonIfPresent<GooglePlacesCacheSnapshot>(options.cachePath);
  const previousByRegistration = new Map(
    (previous?.records ?? []).map((record) => [record.officialRegistrationNumber, record]),
  );
  const benchmark = await readJsonIfPresent<BenchmarkSnapshot>(options.benchmarkPath);
  const benchmarkByRegistration = new Map(
    (benchmark?.records ?? []).map((record) => [record.registration, record]),
  );
  const records: GooglePlacesCacheRecord[] = [];
  let apiRequests = 0;
  let reusedCache = 0;
  let reusedBenchmark = 0;
  let lastRequestAt = 0;

  async function providerSearch(query: string): Promise<GooglePlaceResult[]> {
    const waitFor = REQUEST_INTERVAL_MILLISECONDS - (Date.now() - lastRequestAt);
    if (waitFor > 0) await delay(waitFor);
    try {
      apiRequests += 1;
      return await fetchGooglePlaces(query, placesApiKey);
    } finally {
      lastRequestAt = Date.now();
    }
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
      let results: GooglePlaceResult[];
      let retrievedAt: string;
      if (benchmarkRecord && benchmark) {
        results = benchmarkRecord.candidates.map(benchmarkPlaces);
        retrievedAt = benchmark.generatedAt;
        reusedBenchmark += 1;
      } else if (!pharmacy.phoneE164) {
        results = await providerSearch(buildGoogleFallbackQuery(pharmacy));
        retrievedAt = new Date().toISOString();
      } else {
        const phoneResults = await providerSearch(
          buildGooglePhoneQuery(pharmacy.phoneE164),
        );
        const reconciliation = reconcileGooglePlacesResults(pharmacy, phoneResults);
        results = phoneResults;
        if (reconciliation.classification !== "exact_identity_match") {
          const fallbackResults = await providerSearch(
            buildGoogleFallbackQuery(pharmacy),
          );
          results = [...phoneResults, ...fallbackResults];
        }
        retrievedAt = new Date().toISOString();
      }
      const reconciliation = reconcileGooglePlacesResults(pharmacy, results);
      record = googleCacheRecord(
        pharmacy.officialRegistrationNumber,
        reconciliation,
        retrievedAt,
      );
    }
    records.push(record);
    await saveCache(options.cachePath, records);
    process.stdout.write(
      `[${index + 1}/${selected.length}] ${pharmacy.officialRegistrationNumber} ${record.classification}\n`,
    );
  }

  const reconciledRecords = rejectDuplicateTrustedGooglePlaceIds(records);
  const cache = await saveCache(options.cachePath, reconciledRecords);
  const links = await saveLinks(options.linksPath, reconciledRecords);
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
        apiRequests,
        reusedCache,
        reusedBenchmark,
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
