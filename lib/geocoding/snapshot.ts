import type { GeocodeQuality } from "@/lib/domain/types";
import type { NominatimResult } from "@/lib/geocoding/nominatim";

export type GeocodingRecordStatus =
  | "accepted"
  | "ambiguous"
  | "failed"
  | "already_present";

export interface GeocodingRecord {
  officialRegistrationNumber: string;
  query: string;
  attemptedAt: string;
  status: GeocodingRecordStatus;
  providerResults: NominatimResult[];
  reason: string | null;
  accepted: {
    latitude: number;
    longitude: number;
    resultIdentifier: string;
    displayName: string;
    quality: GeocodeQuality;
    reasons: string[];
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

export interface GeocodingSnapshot {
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
  records: GeocodingRecord[];
}

export function summarizeGeocodingRecords(
  records: GeocodingRecord[],
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
