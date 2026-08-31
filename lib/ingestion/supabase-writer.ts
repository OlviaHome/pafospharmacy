import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import type {
  NormalizedDutyAssignment,
  NormalizedOfficialImport,
  NormalizedOfficialPharmacy,
} from "./normalize";

const BATCH_SIZE = 250;

export interface DatabaseImportReport {
  pharmaciesInserted: number;
  pharmaciesUpdated: number;
  dutyAssignmentsInserted: number;
  dutyAssignmentsUpdated: number;
}

function batches<T>(values: T[], size = BATCH_SIZE): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}

async function existingValues(
  client: SupabaseClient,
  table: "pharmacies" | "duty_assignments",
  column: "official_registration_number" | "source_record_identifier",
  values: string[],
): Promise<Set<string>> {
  const existing = new Set<string>();
  for (const batch of batches(values)) {
    const { data, error } = await client.from(table).select(column).in(column, batch);
    if (error) throw new Error(`Unable to inspect existing ${table}: ${error.message}`);
    for (const row of data ?? []) {
      const value = (row as Record<string, string | null>)[column];
      if (value) existing.add(value);
    }
  }
  return existing;
}

function pharmacyRow(pharmacy: NormalizedOfficialPharmacy) {
  return {
    name: pharmacy.name,
    address_line: pharmacy.addressLine,
    locality: pharmacy.locality,
    postal_code: pharmacy.postalCode,
    latitude: pharmacy.latitude,
    longitude: pharmacy.longitude,
    phone_e164: pharmacy.phoneE164,
    is_active: true,
    official_registration_number: pharmacy.officialRegistrationNumber,
    pharmacist_given_name: pharmacy.pharmacistGivenName,
    pharmacist_surname: pharmacy.pharmacistSurname,
    address_additional: pharmacy.addressAdditional,
    district: pharmacy.district,
    house_phone_e164: pharmacy.housePhoneE164,
    house_phone_raw: pharmacy.housePhoneRaw,
    house_phone_e164_values: pharmacy.housePhoneE164Values,
    source: pharmacy.source,
    source_dataset: pharmacy.sourceDataset,
    source_record_identifier: pharmacy.sourceRecordIdentifier,
    source_resource_url: pharmacy.sourceResourceUrl,
    source_retrieved_at: pharmacy.sourceRetrievedAt,
    updated_at: pharmacy.sourceRetrievedAt,
  };
}

function dutyRow(assignment: NormalizedDutyAssignment, pharmacyId: number) {
  return {
    pharmacy_id: pharmacyId,
    duty_date: assignment.dutyDate,
    source: assignment.source,
    source_dataset: assignment.sourceDataset,
    source_record_identifier: assignment.sourceRecordIdentifier,
    source_resource_url: assignment.sourceResourceUrl,
    source_retrieved_at: assignment.sourceRetrievedAt,
    updated_at: assignment.sourceRetrievedAt,
  };
}

export async function writeOfficialImportToSupabase(
  normalized: NormalizedOfficialImport,
  url: string,
  secretKey: string,
): Promise<DatabaseImportReport> {
  const client = createClient(url, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const registrationNumbers = normalized.pharmacies.map(
    (pharmacy) => pharmacy.officialRegistrationNumber,
  );
  const sourceIdentifiers = normalized.dutyAssignments.map(
    (assignment) => assignment.sourceRecordIdentifier,
  );
  const [existingPharmacies, existingAssignments] = await Promise.all([
    existingValues(client, "pharmacies", "official_registration_number", registrationNumbers),
    existingValues(client, "duty_assignments", "source_record_identifier", sourceIdentifiers),
  ]);

  for (const batch of batches(normalized.pharmacies.map(pharmacyRow))) {
    const { error } = await client
      .from("pharmacies")
      .upsert(batch, { onConflict: "official_registration_number" });
    if (error) throw new Error(`Unable to upsert pharmacies: ${error.message}`);
  }

  const pharmacyIds = new Map<string, number>();
  for (const batch of batches(registrationNumbers)) {
    const { data, error } = await client
      .from("pharmacies")
      .select("id,official_registration_number")
      .in("official_registration_number", batch);
    if (error) throw new Error(`Unable to resolve imported pharmacy IDs: ${error.message}`);
    for (const row of data ?? []) {
      if (row.official_registration_number) {
        pharmacyIds.set(row.official_registration_number, row.id);
      }
    }
  }

  const dutyRows = normalized.dutyAssignments.map((assignment) => {
    const pharmacyId = pharmacyIds.get(assignment.pharmacyRegistrationNumber);
    if (!pharmacyId) {
      throw new Error(
        `No database pharmacy ID resolved for registration ${assignment.pharmacyRegistrationNumber}`,
      );
    }
    return dutyRow(assignment, pharmacyId);
  });
  for (const batch of batches(dutyRows)) {
    const { error } = await client
      .from("duty_assignments")
      .upsert(batch, { onConflict: "source,source_record_identifier" });
    if (error) throw new Error(`Unable to upsert duty assignments: ${error.message}`);
  }

  return {
    pharmaciesInserted: registrationNumbers.length - existingPharmacies.size,
    pharmaciesUpdated: existingPharmacies.size,
    dutyAssignmentsInserted: sourceIdentifiers.length - existingAssignments.size,
    dutyAssignmentsUpdated: existingAssignments.size,
  };
}
