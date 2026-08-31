import "server-only";

import { createClient } from "@supabase/supabase-js";

import officialSnapshot from "@/data/official/cyprus-pharmacies-2026.json";
import { getCyprusDayWindow } from "@/lib/domain/date";
import type {
  AvailabilityInterval,
  DataAttribution,
  DutyAssignment,
  Pharmacy,
  PharmacyDataset,
  ScheduleKind,
  ServiceMode,
} from "@/lib/domain/types";

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
  phone_e164: string | null;
  house_phone_e164: string | null;
  official_registration_number: string | null;
  pharmacist_given_name: string | null;
  pharmacist_surname: string | null;
  source: string;
  source_dataset: string | null;
  source_resource_url: string | null;
  source_retrieved_at: string | null;
  availability_intervals: SupabaseIntervalRow[] | null;
  duty_assignments: SupabaseDutyAssignmentRow[] | null;
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

function mapPharmacy(row: SupabasePharmacyRow): Pharmacy {
  return {
    id: String(row.id),
    name: row.name,
    addressLine: row.address_line,
    addressAdditional: row.address_additional,
    locality: row.locality,
    district: row.district,
    postalCode: row.postal_code,
    latitude: row.latitude,
    longitude: row.longitude,
    phoneE164: row.phone_e164,
    housePhoneE164: row.house_phone_e164,
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

function getOfficialSnapshotDataset(): PharmacyDataset {
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

  return {
    pharmacies: paphosPharmacies.map((pharmacy) => ({
      id: `official-${pharmacy.officialRegistrationNumber}`,
      name: pharmacy.name,
      addressLine: pharmacy.addressLine,
      addressAdditional: pharmacy.addressAdditional,
      locality: pharmacy.locality,
      district: pharmacy.district,
      postalCode: pharmacy.postalCode,
      latitude: pharmacy.latitude,
      longitude: pharmacy.longitude,
      phoneE164: pharmacy.phoneE164,
      housePhoneE164: pharmacy.housePhoneE164,
      officialRegistrationNumber: pharmacy.officialRegistrationNumber,
      pharmacistGivenName: pharmacy.pharmacistGivenName,
      pharmacistSurname: pharmacy.pharmacistSurname,
      source: pharmacy.source,
      sourceDataset: pharmacy.sourceDataset,
      sourceResourceUrl: pharmacy.sourceResourceUrl,
      sourceRetrievedAt: pharmacy.sourceRetrievedAt,
      intervals: [],
      dutyAssignments: assignmentsByRegistration.get(pharmacy.officialRegistrationNumber) ?? [],
    })),
    source: "official_snapshot",
    generatedAt: officialSnapshot.metadata.generatedAt,
    ordinaryOpeningDataAvailable: false,
    attribution,
  };
}

export async function getPharmacyDataset(now: Date): Promise<PharmacyDataset> {
  const url = process.env.SUPABASE_URL;
  const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY;

  if (!url && !publishableKey) return getOfficialSnapshotDataset();

  if (!url || !publishableKey) {
    throw new Error(
      "Supabase configuration is incomplete. Set both SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY, or neither to use the checked-in official snapshot.",
    );
  }

  const today = getCyprusDayWindow(now);
  const tomorrow = getCyprusDayWindow(now, 1);
  const supabase = createClient(url, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await supabase
    .from("pharmacies")
    .select(
      "id,name,address_line,address_additional,locality,district,postal_code,latitude,longitude,phone_e164,house_phone_e164,official_registration_number,pharmacist_given_name,pharmacist_surname,source,source_dataset,source_resource_url,source_retrieved_at,availability_intervals(id,pharmacy_id,starts_at,ends_at,schedule_kind,service_mode),duty_assignments(id,pharmacy_id,duty_date,source_dataset,source_record_identifier,source_resource_url,source_retrieved_at)",
    )
    .eq("is_active", true)
    .eq("district", "Paphos")
    .lt("availability_intervals.starts_at", tomorrow.end)
    .gt("availability_intervals.ends_at", today.start)
    .gte("duty_assignments.duty_date", today.localDate)
    .lte("duty_assignments.duty_date", tomorrow.localDate)
    .order("name");

  if (error) {
    throw new Error(`Unable to load pharmacy data from Supabase: ${error.message}`);
  }

  return {
    pharmacies: ((data ?? []) as SupabasePharmacyRow[]).map(mapPharmacy),
    source: "supabase",
    generatedAt: now.toISOString(),
    ordinaryOpeningDataAvailable: false,
    attribution,
  };
}
