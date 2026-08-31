export type ScheduleKind = "ordinary" | "duty";
export type ServiceMode = "open" | "on_call" | "unknown";
export type KnownBoolean = boolean | "unknown";

export interface AvailabilityInterval {
  id: string;
  pharmacyId: string;
  startsAt: string;
  endsAt: string;
  scheduleKind: ScheduleKind;
  serviceMode: ServiceMode;
}

export interface Pharmacy {
  id: string;
  name: string;
  addressLine: string;
  locality: string;
  postalCode: string | null;
  latitude: number;
  longitude: number;
  phoneE164: string;
  intervals: AvailabilityInterval[];
}

export interface DerivedAvailability {
  openNow: KnownBoolean;
  onDuty: boolean;
  onCall: KnownBoolean;
  hasConflict: boolean;
  activeIntervals: AvailabilityInterval[];
}

export interface DayWindow {
  start: string;
  end: string;
  localDate: string;
}

export interface Coordinates {
  latitude: number;
  longitude: number;
}

export type PharmacyDataSource = "fixtures" | "supabase";

export interface PharmacyDataset {
  pharmacies: Pharmacy[];
  source: PharmacyDataSource;
  generatedAt: string;
}
