import "server-only";

import { createClient } from "@supabase/supabase-js";

import { getCyprusDayWindow } from "@/lib/domain/date";
import type {
  AvailabilityInterval,
  Pharmacy,
  PharmacyDataset,
  ScheduleKind,
  ServiceMode,
} from "@/lib/domain/types";

import { createFixturePharmacies } from "./fixtures";

interface SupabaseIntervalRow {
  id: number;
  pharmacy_id: number;
  starts_at: string;
  ends_at: string;
  schedule_kind: ScheduleKind;
  service_mode: ServiceMode;
}

interface SupabasePharmacyRow {
  id: number;
  name: string;
  address_line: string;
  locality: string;
  postal_code: string | null;
  latitude: number;
  longitude: number;
  phone_e164: string;
  availability_intervals: SupabaseIntervalRow[] | null;
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

function mapPharmacy(row: SupabasePharmacyRow): Pharmacy {
  return {
    id: String(row.id),
    name: row.name,
    addressLine: row.address_line,
    locality: row.locality,
    postalCode: row.postal_code,
    latitude: row.latitude,
    longitude: row.longitude,
    phoneE164: row.phone_e164,
    intervals: (row.availability_intervals ?? []).map(mapInterval),
  };
}

export async function getPharmacyDataset(now: Date): Promise<PharmacyDataset> {
  const url = process.env.SUPABASE_URL;
  const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY;

  if (!url && !publishableKey) {
    return {
      pharmacies: createFixturePharmacies(now),
      source: "fixtures",
      generatedAt: now.toISOString(),
    };
  }

  if (!url || !publishableKey) {
    throw new Error(
      "Supabase configuration is incomplete. Set both SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY, or neither to use fixtures.",
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
      "id,name,address_line,locality,postal_code,latitude,longitude,phone_e164,availability_intervals(id,pharmacy_id,starts_at,ends_at,schedule_kind,service_mode)",
    )
    .eq("is_active", true)
    .lt("availability_intervals.starts_at", tomorrow.end)
    .gt("availability_intervals.ends_at", today.start)
    .order("name");

  if (error) {
    throw new Error(`Unable to load pharmacy data from Supabase: ${error.message}`);
  }

  return {
    pharmacies: ((data ?? []) as SupabasePharmacyRow[]).map(mapPharmacy),
    source: "supabase",
    generatedAt: now.toISOString(),
  };
}
