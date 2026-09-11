export type ScheduleKind = "ordinary" | "duty";
export type ServiceMode = "open" | "on_call" | "unknown";
export type KnownBoolean = boolean | "unknown";
export type GeocodeQuality = "high" | "medium";

export interface AvailabilityInterval {
  id: string;
  pharmacyId: string;
  startsAt: string;
  endsAt: string;
  scheduleKind: ScheduleKind;
  serviceMode: ServiceMode;
}

export interface DutyAssignment {
  id: string;
  pharmacyId: string;
  dutyDate: string;
  sourceDataset: string;
  sourceRecordIdentifier: string;
  sourceResourceUrl: string;
  sourceRetrievedAt: string;
}

export interface Pharmacy {
  id: string;
  name: string;
  addressLine: string;
  addressAdditional: string | null;
  locality: string;
  district: string | null;
  postalCode: string | null;
  latitude: number | null;
  longitude: number | null;
  geocodeProvider: string | null;
  geocodeResultIdentifier: string | null;
  geocodeQuery: string | null;
  geocodeQuality: GeocodeQuality | null;
  geocodedAt: string | null;
  phoneE164: string | null;
  officialRegistrationNumber: string | null;
  pharmacistGivenName: string | null;
  pharmacistSurname: string | null;
  source: string;
  sourceDataset: string | null;
  sourceResourceUrl: string | null;
  sourceRetrievedAt: string | null;
  intervals: AvailabilityInterval[];
  dutyAssignments: DutyAssignment[];
}

export interface DerivedAvailability {
  openNow: KnownBoolean;
  onDuty: boolean;
  onCall: KnownBoolean;
  hasConflict: boolean;
  activeIntervals: AvailabilityInterval[];
  activeDutyAssignments: DutyAssignment[];
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

export type PharmacyDataSource = "fixtures" | "official_snapshot" | "supabase";

export interface DataAttribution {
  organization: string;
  datasetPage: string;
  license: string;
  licenseUrl: string;
  retrievedAt: string;
  dutyCoverageStart: string;
  dutyCoverageEnd: string;
}

export interface CoordinateAttribution {
  providerId: string;
  provider: string;
  attribution: string;
  attributionUrl: string;
  license: string;
  licenseUrl: string;
  policyUrl: string;
  generatedAt: string;
}

export interface PharmacyDataset {
  pharmacies: Pharmacy[];
  source: PharmacyDataSource;
  generatedAt: string;
  ordinaryOpeningDataAvailable: boolean;
  attribution: DataAttribution | null;
  coordinateAttributions: CoordinateAttribution[];
}
