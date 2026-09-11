import "server-only";

import { createClient } from "@supabase/supabase-js";
import { readFile } from "node:fs/promises";
import path from "node:path";

import geoapifySnapshotJson from "@/data/geocoding/paphos-geoapify-2026.json";
import googlePlaceLinksJson from "@/data/geocoding/paphos-google-place-links-2026.json";
import geocodingSnapshot from "@/data/geocoding/paphos-nominatim-2026.json";
import officialSnapshot from "@/data/official/cyprus-pharmacies-2026.json";
import { getCyprusDayWindow } from "@/lib/domain/date";
import type {
  AvailabilityInterval,
  CoordinateAttribution,
  DataAttribution,
  DutyAssignment,
  GeocodeQuality,
  Pharmacy,
  PharmacyDataset,
  ScheduleKind,
  ServiceMode,
} from "@/lib/domain/types";
import type { GeoapifyResult } from "@/lib/geocoding/geoapify";
import {
  GOOGLE_PLACES_PROVIDER,
  isGoogleCoordinateCacheUsable,
  isPaphosFallbackDisputed,
  isTrustedGoogleCoordinateCache,
  type GooglePlaceLinkSnapshot,
  type GooglePlacesCacheRecord,
  type GooglePlacesCacheSnapshot,
} from "@/lib/geocoding/google-places";
import type { GeocodingSnapshot } from "@/lib/geocoding/snapshot";

const geoapifySnapshot =
  geoapifySnapshotJson as unknown as GeocodingSnapshot<GeoapifyResult>;
const googlePlaceLinks =
  googlePlaceLinksJson as unknown as GooglePlaceLinkSnapshot;
const GOOGLE_CACHE_PATH = path.join(
  process.cwd(),
  "data/geocoding/cache/paphos-google-places.json",
);

interface SupabaseIntervalRow {
  id: number;
  pharmacy_id: number;
  starts_at: string;
  ends_at: string;
  schedule_kind: ScheduleKind;
  service_mode: ServiceMode;
}

interface SupabaseDutyAssignmentRow {
  id: number;
  pharmacy_id: number;
  duty_date: string;
  source_dataset: string;
  source_record_identifier: string;
  source_resource_url: string;
  source_retrieved_at: string;
}

interface SupabaseGooglePlaceRow {
  official_registration_number: string;
  place_id: string | null;
  display_name: string | null;
  formatted_address: string | null;
  latitude: number | null;
  longitude: number | null;
  google_phone_e164: string | null;
  classification:
    | "exact_identity_match"
    | "probable_match"
    | "ambiguous"
    | "no_match";
  matching_evidence: string[];
  retrieved_at: string;
  expires_at: string;
}

interface SupabasePharmacyRow {
  id: number;
  name: string;
  address_line: string;
  address_additional: string | null;
  locality: string;
  district: string | null;
  postal_code: string | null;
  latitude: number | null;
  longitude: number | null;
  geocode_provider: string | null;
  geocode_result_identifier: string | null;
  geocode_query: string | null;
  geocode_quality: GeocodeQuality | null;
  geocoded_at: string | null;
  phone_e164: string | null;
  official_registration_number: string | null;
  pharmacist_given_name: string | null;
  pharmacist_surname: string | null;
  source: string;
  source_dataset: string | null;
  source_resource_url: string | null;
  source_retrieved_at: string | null;
  availability_intervals: SupabaseIntervalRow[] | null;
  duty_assignments: SupabaseDutyAssignmentRow[] | null;
  pharmacy_google_places:
    | SupabaseGooglePlaceRow
    | SupabaseGooglePlaceRow[]
    | null;
}

const attribution: DataAttribution = {
  organization: officialSnapshot.metadata.organization,
  datasetPage: officialSnapshot.metadata.datasetPage,
  license: officialSnapshot.metadata.license,
  licenseUrl: officialSnapshot.metadata.licenseUrl,
  retrievedAt: officialSnapshot.metadata.generatedAt,
  dutyCoverageStart: officialSnapshot.metadata.dutyCoverageStart,
  dutyCoverageEnd: officialSnapshot.metadata.dutyCoverageEnd,
};

const nominatimCoordinateAttribution: CoordinateAttribution = {
  providerId: geocodingSnapshot.metadata.provider.id,
  provider: geocodingSnapshot.metadata.provider.name,
  attribution: geocodingSnapshot.metadata.provider.attribution,
  attributionUrl: geocodingSnapshot.metadata.provider.attributionUrl,
  license: geocodingSnapshot.metadata.provider.license,
  licenseUrl: geocodingSnapshot.metadata.provider.licenseUrl,
  policyUrl: geocodingSnapshot.metadata.provider.policyUrl,
  generatedAt: geocodingSnapshot.metadata.generatedAt,
};

const geoapifyCoordinateAttribution: CoordinateAttribution = {
  providerId: geoapifySnapshot.metadata.provider.id,
  provider: geoapifySnapshot.metadata.provider.name,
  attribution: geoapifySnapshot.metadata.provider.attribution,
  attributionUrl: geoapifySnapshot.metadata.provider.attributionUrl,
  license: geoapifySnapshot.metadata.provider.license,
  licenseUrl: geoapifySnapshot.metadata.provider.licenseUrl,
  policyUrl: geoapifySnapshot.metadata.provider.policyUrl,
  generatedAt: geoapifySnapshot.metadata.generatedAt,
};

function googleCoordinateAttribution(generatedAt: string): CoordinateAttribution {
  return {
    providerId: GOOGLE_PLACES_PROVIDER,
    provider: "Google Places API (New)",
    attribution: "Google Maps",
    attributionUrl: "https://www.google.com/maps",
    license: "Google Maps Platform Terms of Service",
    licenseUrl: "https://cloud.google.com/maps-platform/terms",
    policyUrl: "https://developers.google.com/maps/documentation/places/web-service/policies",
    generatedAt,
  };
}

function coordinateAttributionsFor(
  pharmacies: Pharmacy[],
  googleGeneratedAt: string | null,
): CoordinateAttribution[] {
  return [
    ...(pharmacies.some(
      (pharmacy) =>
        pharmacy.geocodeProvider === geocodingSnapshot.metadata.provider.id,
    )
      ? [nominatimCoordinateAttribution]
      : []),
    ...(pharmacies.some(
      (pharmacy) => pharmacy.geocodeProvider === geoapifySnapshot.metadata.provider.id,
    )
      ? [geoapifyCoordinateAttribution]
      : []),
    ...(pharmacies.some(
      (pharmacy) => pharmacy.geocodeProvider === GOOGLE_PLACES_PROVIDER,
    ) && googleGeneratedAt
      ? [googleCoordinateAttribution(googleGeneratedAt)]
      : []),
  ];
}

const geocodingByRegistration = new Map(
  [
    ...geocodingSnapshot.records.map(
      (record) => [record, geocodingSnapshot.metadata.provider.id] as const,
    ),
    ...geoapifySnapshot.records.map(
      (record) => [record, geoapifySnapshot.metadata.provider.id] as const,
    ),
  ].flatMap(([record, providerId]) =>
    record.status === "accepted" &&
    record.accepted &&
    !isPaphosFallbackDisputed(record.officialRegistrationNumber)
      ? [[record.officialRegistrationNumber, {
          ...record.accepted,
          providerId,
          query: record.query,
          attemptedAt: record.attemptedAt,
        }] as const]
      : [],
  ),
);

interface TrustedGoogleCache {
  records: Map<string, GooglePlacesCacheRecord>;
  generatedAt: string | null;
}

async function readTrustedLocalGoogleCache(now: Date): Promise<TrustedGoogleCache> {
  let cache: GooglePlacesCacheSnapshot;
  try {
    cache = JSON.parse(
      await readFile(GOOGLE_CACHE_PATH, "utf8"),
    ) as GooglePlacesCacheSnapshot;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { records: new Map(), generatedAt: null };
    }
    throw error;
  }

  const links = new Map(
    googlePlaceLinks.records.map((link) => [link.officialRegistrationNumber, link]),
  );
  const records = new Map(
    cache.records.flatMap((record) =>
      isTrustedGoogleCoordinateCache(
        record,
        links.get(record.officialRegistrationNumber),
        now,
      )
        ? [[record.officialRegistrationNumber, record] as const]
        : [],
    ),
  );
  return {
    records,
    generatedAt: records.size > 0 ? cache.metadata.generatedAt : null,
  };
}

function mapSupabaseGooglePlace(
  value: SupabasePharmacyRow["pharmacy_google_places"],
): GooglePlacesCacheRecord | null {
  const row = Array.isArray(value) ? value[0] : value;
  if (!row) return null;
  return {
    officialRegistrationNumber: row.official_registration_number,
    placeId: row.place_id,
    displayName: row.display_name,
    formattedAddress: row.formatted_address,
    latitude: row.latitude,
    longitude: row.longitude,
    googlePhoneE164: row.google_phone_e164,
    classification: row.classification,
    matchingEvidence: row.matching_evidence,
    retrievedAt: row.retrieved_at,
    expiresAt: row.expires_at,
  };
}

function mapInterval(row: SupabaseIntervalRow): AvailabilityInterval {
  return {
    id: String(row.id),
    pharmacyId: String(row.pharmacy_id),
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    scheduleKind: row.schedule_kind,
    serviceMode: row.service_mode,
  };
}

function mapDutyAssignment(row: SupabaseDutyAssignmentRow): DutyAssignment {
  return {
    id: String(row.id),
    pharmacyId: String(row.pharmacy_id),
    dutyDate: row.duty_date,
    sourceDataset: row.source_dataset,
    sourceRecordIdentifier: row.source_record_identifier,
    sourceResourceUrl: row.source_resource_url,
    sourceRetrievedAt: row.source_retrieved_at,
  };
}

function hasTrustedPersistedFallback(row: SupabasePharmacyRow): boolean {
  return (
    row.official_registration_number !== null &&
    !isPaphosFallbackDisputed(row.official_registration_number) &&
    (row.geocode_provider === geocodingSnapshot.metadata.provider.id ||
      row.geocode_provider === geoapifySnapshot.metadata.provider.id) &&
    row.geocode_result_identifier !== null &&
    row.geocode_query !== null &&
    row.geocode_quality !== null &&
    row.geocoded_at !== null &&
    row.latitude !== null &&
    row.longitude !== null &&
    Number.isFinite(row.latitude) &&
    Number.isFinite(row.longitude)
  );
}

function mapPharmacy(row: SupabasePharmacyRow, now: Date): Pharmacy {
  const google = mapSupabaseGooglePlace(row.pharmacy_google_places);
  const useGoogle = google !== null && isGoogleCoordinateCacheUsable(google, now);
  const useFallback = !useGoogle && hasTrustedPersistedFallback(row);
  return {
    id: String(row.id),
    name: row.name,
    addressLine: row.address_line,
    addressAdditional: row.address_additional,
    locality: row.locality,
    district: row.district,
    postalCode: row.postal_code,
    latitude: useGoogle ? google.latitude : useFallback ? row.latitude : null,
    longitude: useGoogle ? google.longitude : useFallback ? row.longitude : null,
    geocodeProvider: useGoogle
      ? GOOGLE_PLACES_PROVIDER
      : useFallback
        ? row.geocode_provider
        : null,
    geocodeResultIdentifier: useGoogle
      ? google.placeId
      : useFallback
        ? row.geocode_result_identifier
        : null,
    geocodeQuery: useGoogle ? null : useFallback ? row.geocode_query : null,
    geocodeQuality: useGoogle
      ? "high"
      : useFallback
        ? row.geocode_quality
        : null,
    geocodedAt: useGoogle
      ? google.retrievedAt
      : useFallback
        ? row.geocoded_at
        : null,
    phoneE164: row.phone_e164,
    officialRegistrationNumber: row.official_registration_number,
    pharmacistGivenName: row.pharmacist_given_name,
    pharmacistSurname: row.pharmacist_surname,
    source: row.source,
    sourceDataset: row.source_dataset,
    sourceResourceUrl: row.source_resource_url,
    sourceRetrievedAt: row.source_retrieved_at,
    intervals: (row.availability_intervals ?? []).map(mapInterval),
    dutyAssignments: (row.duty_assignments ?? []).map(mapDutyAssignment),
  };
}

async function getOfficialSnapshotDataset(now: Date): Promise<PharmacyDataset> {
  const googleCache = await readTrustedLocalGoogleCache(now);
  const paphosPharmacies = officialSnapshot.pharmacies.filter(
    (pharmacy) => pharmacy.district === "Paphos",
  );
  const paphosRegistrationNumbers = new Set(
    paphosPharmacies.map((pharmacy) => pharmacy.officialRegistrationNumber),
  );
  const assignmentsByRegistration = new Map<string, DutyAssignment[]>();

  for (const assignment of officialSnapshot.dutyAssignments) {
    if (!paphosRegistrationNumbers.has(assignment.pharmacyRegistrationNumber)) continue;
    const assignments = assignmentsByRegistration.get(assignment.pharmacyRegistrationNumber) ?? [];
    assignments.push({
      id: assignment.sourceRecordIdentifier,
      pharmacyId: assignment.pharmacyRegistrationNumber,
      dutyDate: assignment.dutyDate,
      sourceDataset: assignment.sourceDataset,
      sourceRecordIdentifier: assignment.sourceRecordIdentifier,
      sourceResourceUrl: assignment.sourceResourceUrl,
      sourceRetrievedAt: assignment.sourceRetrievedAt,
    });
    assignmentsByRegistration.set(assignment.pharmacyRegistrationNumber, assignments);
  }

  const pharmacies: Pharmacy[] = paphosPharmacies.map((pharmacy) => {
    const geocoding = geocodingByRegistration.get(
      pharmacy.officialRegistrationNumber,
    );
    const google = googleCache.records.get(pharmacy.officialRegistrationNumber);
    return {
      id: `official-${pharmacy.officialRegistrationNumber}`,
      name: pharmacy.name,
      addressLine: pharmacy.addressLine,
      addressAdditional: pharmacy.addressAdditional,
      locality: pharmacy.locality,
      district: pharmacy.district,
      postalCode: pharmacy.postalCode,
      latitude: google?.latitude ?? geocoding?.latitude ?? pharmacy.latitude,
      longitude: google?.longitude ?? geocoding?.longitude ?? pharmacy.longitude,
      geocodeProvider: google
        ? GOOGLE_PLACES_PROVIDER
        : geocoding?.providerId ?? null,
      geocodeResultIdentifier:
        google?.placeId ?? geocoding?.resultIdentifier ?? null,
      geocodeQuery: google ? null : geocoding?.query ?? null,
      geocodeQuality: google
        ? "high"
        : (geocoding?.quality as GeocodeQuality | undefined) ?? null,
      geocodedAt: google?.retrievedAt ?? geocoding?.attemptedAt ?? null,
      phoneE164: pharmacy.phoneE164,
      officialRegistrationNumber: pharmacy.officialRegistrationNumber,
      pharmacistGivenName: pharmacy.pharmacistGivenName,
      pharmacistSurname: pharmacy.pharmacistSurname,
      source: pharmacy.source,
      sourceDataset: pharmacy.sourceDataset,
      sourceResourceUrl: pharmacy.sourceResourceUrl,
      sourceRetrievedAt: pharmacy.sourceRetrievedAt,
      intervals: [],
      dutyAssignments:
        assignmentsByRegistration.get(pharmacy.officialRegistrationNumber) ?? [],
    };
  });

  return {
    pharmacies,
    source: "official_snapshot",
    generatedAt: officialSnapshot.metadata.generatedAt,
    ordinaryOpeningDataAvailable: false,
    attribution,
    coordinateAttributions: coordinateAttributionsFor(
      pharmacies,
      googleCache.generatedAt,
    ),
  };
}

export async function getPharmacyDataset(now: Date): Promise<PharmacyDataset> {
  const url = process.env.SUPABASE_URL?.trim();
  const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY?.trim();

  if (!url && !publishableKey) {
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "Supabase runtime configuration is required in production. Set SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY.",
      );
    }
    return getOfficialSnapshotDataset(now);
  }

  if (!url || !publishableKey) {
    throw new Error(
      "Supabase runtime configuration is incomplete. Set both SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY. The checked-in snapshot fallback is available only outside production when both values are absent.",
    );
  }

  const yesterday = getCyprusDayWindow(now, -1);
  const today = getCyprusDayWindow(now);
  const tomorrow = getCyprusDayWindow(now, 1);
  const supabase = createClient(url, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await supabase
    .from("pharmacies")
    .select(
      "id,name,address_line,address_additional,locality,district,postal_code,latitude,longitude,geocode_provider,geocode_result_identifier,geocode_query,geocode_quality,geocoded_at,phone_e164,official_registration_number,pharmacist_given_name,pharmacist_surname,source,source_dataset,source_resource_url,source_retrieved_at,availability_intervals(id,pharmacy_id,starts_at,ends_at,schedule_kind,service_mode),duty_assignments(id,pharmacy_id,duty_date,source_dataset,source_record_identifier,source_resource_url,source_retrieved_at),pharmacy_google_places(official_registration_number,place_id,display_name,formatted_address,latitude,longitude,google_phone_e164,classification,matching_evidence,retrieved_at,expires_at)",
    )
    .eq("is_active", true)
    .eq("district", "Paphos")
    .lt("availability_intervals.starts_at", tomorrow.end)
    .gt("availability_intervals.ends_at", today.start)
    .gte("duty_assignments.duty_date", yesterday.localDate)
    .lte("duty_assignments.duty_date", tomorrow.localDate)
    .order("name");

  if (error) {
    throw new Error(`Unable to load pharmacy data from Supabase: ${error.message}`);
  }

  const pharmacies = ((data ?? []) as SupabasePharmacyRow[]).map((row) =>
    mapPharmacy(row, now),
  );
  const googleGeneratedAt = pharmacies
    .filter((pharmacy) => pharmacy.geocodeProvider === GOOGLE_PLACES_PROVIDER)
    .reduce<string | null>(
      (latest, pharmacy) =>
        !latest || (pharmacy.geocodedAt ?? "") > latest
          ? pharmacy.geocodedAt
          : latest,
      null,
    );
  return {
    pharmacies,
    source: "supabase",
    generatedAt: now.toISOString(),
    ordinaryOpeningDataAvailable: false,
    attribution,
    coordinateAttributions: coordinateAttributionsFor(
      pharmacies,
      googleGeneratedAt,
    ),
  };
}
