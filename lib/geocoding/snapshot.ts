import type { GeocodeQuality } from "@/lib/domain/types";
import type { NominatimResult } from "@/lib/geocoding/nominatim";

export type GeocodingRecordStatus =
  | "accepted"
  | "ambiguous"
  | "failed"
  | "already_present";

export interface GeocodingRecord<ProviderResult = NominatimResult> {
  officialRegistrationNumber: string;
  query: string;
  attemptedAt: string;
  status: GeocodingRecordStatus;
  providerResults: ProviderResult[];
  reason: string | null;
  accepted: {
    latitude: number;
    longitude: number;
    resultIdentifier: string;
    displayName: string;
    quality: GeocodeQuality;
    reasons: string[];
    matchMetadata?: unknown;
  } | null;
}

export interface GeocodingReport {
  selectedPharmacies: number;
  attempted: number;
  successfullyGeocoded: number;
  ambiguous: number;
  failed: number;
  coordinatesAlreadyPresent: number;
  qualityDistribution: Record<GeocodeQuality, number>;
}

export interface GeocodingSnapshot<ProviderResult = NominatimResult> {
  metadata: {
    schemaVersion: 1;
    generatedAt: string;
    district: string;
    sourceSnapshot: string;
    sourceSnapshotGeneratedAt: string;
    provider: {
      id: string;
      name: string;
      endpoint: string;
      policyUrl: string;
      attribution: string;
      attributionUrl: string;
      license: string;
      licenseUrl: string;
      requestIntervalMilliseconds: number;
    };
  };
  report: GeocodingReport;
  records: GeocodingRecord<ProviderResult>[];
}

export function summarizeGeocodingRecords<ProviderResult>(
  records: GeocodingRecord<ProviderResult>[],
): GeocodingReport {
  return {
    selectedPharmacies: records.length,
    attempted: records.filter((record) => record.status !== "already_present").length,
    successfullyGeocoded: records.filter((record) => record.status === "accepted").length,
    ambiguous: records.filter((record) => record.status === "ambiguous").length,
    failed: records.filter((record) => record.status === "failed").length,
    coordinatesAlreadyPresent: records.filter(
      (record) => record.status === "already_present",
    ).length,
    qualityDistribution: {
      high: records.filter((record) => record.accepted?.quality === "high").length,
      medium: records.filter((record) => record.accepted?.quality === "medium").length,
    },
  };
}

export function rejectDuplicateAcceptedResultIdentifiers<ProviderResult>(
  records: GeocodingRecord<ProviderResult>[],
): GeocodingRecord<ProviderResult>[] {
  const counts = new Map<string, number>();
  for (const record of records) {
    if (record.status !== "accepted" || !record.accepted) continue;
    counts.set(
      record.accepted.resultIdentifier,
      (counts.get(record.accepted.resultIdentifier) ?? 0) + 1,
    );
  }

  return records.map((record) => {
    if (
      record.status !== "accepted" ||
      !record.accepted ||
      (counts.get(record.accepted.resultIdentifier) ?? 0) < 2
    ) {
      return record;
    }
    return {
      ...record,
      status: "ambiguous",
      reason:
        "Provider reused one result identifier for multiple official pharmacy addresses.",
      accepted: null,
    };
  });
}
