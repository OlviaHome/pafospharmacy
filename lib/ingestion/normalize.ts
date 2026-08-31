import { parseCsv } from "./csv";
import type { OfficialCsvResource } from "./official-sources";

const DIRECTORY_HEADERS = [
  "District",
  "Reg. No.",
  "Surmame",
  "Name",
  "Address",
  "Additional Address Info",
  "Muniuciplity / Community",
  "PC",
  "Pharmacy Tel. No.",
  "House Tel. No.",
];

const DUTY_HEADERS = [
  "Date",
  "Day",
  "Reg. No.",
  "Surmame",
  "Name",
  "Address",
  "Additional Address Info",
  "Muniuciplity / Community",
  "Pharmacy Tel. No.",
  "House Tel. No.",
];

export interface ResourceText {
  resource: OfficialCsvResource;
  text: string;
}

export interface NormalizedOfficialPharmacy {
  officialRegistrationNumber: string;
  name: string;
  pharmacistGivenName: string;
  pharmacistSurname: string;
  addressLine: string;
  addressAdditional: string | null;
  locality: string;
  district: string;
  postalCode: string | null;
  phoneE164: string | null;
  housePhoneE164: string | null;
  latitude: null;
  longitude: null;
  source: "cyprus_open_data";
  sourceDataset: string;
  sourceRecordIdentifier: string;
  sourceResourceUrl: string;
  sourceRetrievedAt: string;
}

export interface NormalizedDutyAssignment {
  pharmacyRegistrationNumber: string;
  dutyDate: string;
  source: "cyprus_open_data";
  sourceDataset: string;
  sourceRecordIdentifier: string;
  sourceResourceUrl: string;
  sourceRetrievedAt: string;
}

export interface ImportIssue {
  resourceId: string;
  rowNumber: number | null;
  severity: "warning" | "skipped";
  message: string;
}

export interface OfficialImportReport {
  recordsRead: number;
  pharmacyDirectoryRecordsRead: number;
  dutyRecordsRead: number;
  pharmaciesPrepared: number;
  dutyAssignmentsPrepared: number;
  recordsSkipped: number;
  malformedRecords: number;
  duplicatesCollapsed: number;
  districtsEncountered: string[];
  issues: ImportIssue[];
}

export interface NormalizedOfficialImport {
  retrievedAt: string;
  pharmacies: NormalizedOfficialPharmacy[];
  dutyAssignments: NormalizedDutyAssignment[];
  report: OfficialImportReport;
}

function cleaned(value: string | undefined): string {
  return (value ?? "").trim();
}

function optionalText(value: string | undefined): string | null {
  const normalized = cleaned(value);
  return normalized === "" || normalized === "0" ? null : normalized;
}

export function normalizeRegistrationNumber(value: string): string | null {
  const normalized = cleaned(value);
  return /^\d+$/.test(normalized) ? normalized : null;
}

export function normalizeCyprusPhone(value: string): string | null {
  const normalized = cleaned(value).replace(/[\s()-]/g, "");
  if (normalized === "" || normalized === "0") return null;
  if (/^\d{8}$/.test(normalized)) return `+357${normalized}`;
  if (/^357\d{8}$/.test(normalized)) return `+${normalized}`;
  if (/^\+[1-9]\d{7,14}$/.test(normalized)) return normalized;
  return null;
}

export function parseOfficialDate(value: string): string | null {
  const match = /^(\d{2})\/(\d{2})\/(\d{2})$/.exec(cleaned(value));
  if (!match) return null;
  const [, dayText, monthText, yearText] = match;
  const year = 2000 + Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return `${year}-${monthText}-${dayText}`;
}

export function filterOfficialPharmaciesByDistrict(
  pharmacies: NormalizedOfficialPharmacy[],
  district: string,
): NormalizedOfficialPharmacy[] {
  return pharmacies.filter(
    (pharmacy) => pharmacy.district.localeCompare(district, "en", { sensitivity: "base" }) === 0,
  );
}

function assertHeaders(
  actual: string[],
  expected: string[],
  resource: OfficialCsvResource,
  issues: ImportIssue[],
): boolean {
  const missing = expected.filter((header) => !actual.includes(header));
  if (missing.length === 0) return true;
  issues.push({
    resourceId: resource.id,
    rowNumber: null,
    severity: "skipped",
    message: `Resource is missing required headers: ${missing.join(", ")}`,
  });
  return false;
}

function createPharmacy(
  values: Record<string, string>,
  district: string,
  resource: OfficialCsvResource,
  retrievedAt: string,
): NormalizedOfficialPharmacy | null {
  const registrationNumber = normalizeRegistrationNumber(values["Reg. No."]);
  const surname = cleaned(values.Surmame);
  const givenName = cleaned(values.Name);
  const addressLine = cleaned(values.Address);
  const locality = cleaned(values["Muniuciplity / Community"]);
  if (!registrationNumber || !surname || !givenName || !addressLine || !locality || !district) {
    return null;
  }

  return {
    officialRegistrationNumber: registrationNumber,
    name: `${surname} ${givenName}`,
    pharmacistGivenName: givenName,
    pharmacistSurname: surname,
    addressLine,
    addressAdditional: optionalText(values["Additional Address Info"]),
    locality,
    district,
    postalCode: optionalText(values.PC),
    phoneE164: normalizeCyprusPhone(values["Pharmacy Tel. No."]),
    housePhoneE164: normalizeCyprusPhone(values["House Tel. No."]),
    latitude: null,
    longitude: null,
    source: "cyprus_open_data",
    sourceDataset: resource.dataset,
    sourceRecordIdentifier: `pharmacy:${registrationNumber}`,
    sourceResourceUrl: resource.url,
    sourceRetrievedAt: retrievedAt,
  };
}

export function normalizeOfficialResources(
  resources: ResourceText[],
  retrievedAt: string,
): NormalizedOfficialImport {
  const pharmacies = new Map<string, NormalizedOfficialPharmacy>();
  const dutyAssignments = new Map<string, NormalizedDutyAssignment>();
  const issues: ImportIssue[] = [];
  const districts = new Set<string>();
  let recordsRead = 0;
  let directoryRead = 0;
  let dutyRead = 0;
  let skipped = 0;
  let duplicatesCollapsed = 0;

  const directoryResources = resources.filter(({ resource }) => resource.kind === "pharmacy_directory");
  const dutyResources = resources.filter(({ resource }) => resource.kind === "duty_rota");

  for (const { resource, text } of [...directoryResources, ...dutyResources]) {
    let parsed;
    try {
      parsed = parseCsv(text);
    } catch (error) {
      issues.push({
        resourceId: resource.id,
        rowNumber: null,
        severity: "skipped",
        message: error instanceof Error ? error.message : "CSV parsing failed",
      });
      skipped += 1;
      continue;
    }

    if (!assertHeaders(
      parsed.headers,
      resource.kind === "pharmacy_directory" ? DIRECTORY_HEADERS : DUTY_HEADERS,
      resource,
      issues,
    )) {
      skipped += parsed.records.length;
      continue;
    }

    recordsRead += parsed.records.length;
    if (resource.kind === "pharmacy_directory") directoryRead += parsed.records.length;
    else dutyRead += parsed.records.length;

    for (const record of parsed.records) {
      const district = resource.district ?? cleaned(record.values.District);
      if (district) districts.add(district);
      const registrationNumber = normalizeRegistrationNumber(record.values["Reg. No."]);
      const pharmacy = createPharmacy(record.values, district, resource, retrievedAt);

      if (!pharmacy || !registrationNumber) {
        skipped += 1;
        issues.push({
          resourceId: resource.id,
          rowNumber: record.rowNumber,
          severity: "skipped",
          message: "Missing or invalid registration number, pharmacist name, address, locality, or district",
        });
        continue;
      }

      if (resource.kind === "pharmacy_directory") {
        if (pharmacies.has(registrationNumber)) duplicatesCollapsed += 1;
        pharmacies.set(registrationNumber, pharmacy);
      } else if (!pharmacies.has(registrationNumber)) {
        pharmacies.set(registrationNumber, pharmacy);
        issues.push({
          resourceId: resource.id,
          rowNumber: record.rowNumber,
          severity: "warning",
          message: `Registration ${registrationNumber} was absent from the 2026 directory; pharmacy identity was prepared from the duty resource`,
        });
      }

      if (resource.kind === "duty_rota") {
        const dutyDate = parseOfficialDate(record.values.Date);
        if (!dutyDate) {
          skipped += 1;
          issues.push({
            resourceId: resource.id,
            rowNumber: record.rowNumber,
            severity: "skipped",
            message: `Invalid duty date: ${record.values.Date}`,
          });
          continue;
        }
        const sourceRecordIdentifier = `duty:${resource.id}:${dutyDate}:${registrationNumber}`;
        if (dutyAssignments.has(sourceRecordIdentifier)) duplicatesCollapsed += 1;
        dutyAssignments.set(sourceRecordIdentifier, {
          pharmacyRegistrationNumber: registrationNumber,
          dutyDate,
          source: "cyprus_open_data",
          sourceDataset: resource.dataset,
          sourceRecordIdentifier,
          sourceResourceUrl: resource.url,
          sourceRetrievedAt: retrievedAt,
        });
      }

      const rawPharmacyPhone = optionalText(record.values["Pharmacy Tel. No."]);
      if (rawPharmacyPhone && !normalizeCyprusPhone(rawPharmacyPhone)) {
        issues.push({
          resourceId: resource.id,
          rowNumber: record.rowNumber,
          severity: "warning",
          message: `Unrecognized pharmacy telephone format: ${rawPharmacyPhone}`,
        });
      }
    }
  }

  return {
    retrievedAt,
    pharmacies: [...pharmacies.values()].sort((left, right) =>
      left.officialRegistrationNumber.localeCompare(right.officialRegistrationNumber, "en", {
        numeric: true,
      }),
    ),
    dutyAssignments: [...dutyAssignments.values()].sort((left, right) =>
      left.sourceRecordIdentifier.localeCompare(right.sourceRecordIdentifier),
    ),
    report: {
      recordsRead,
      pharmacyDirectoryRecordsRead: directoryRead,
      dutyRecordsRead: dutyRead,
      pharmaciesPrepared: pharmacies.size,
      dutyAssignmentsPrepared: dutyAssignments.size,
      recordsSkipped: skipped,
      malformedRecords: issues.filter((issue) => issue.severity === "skipped").length,
      duplicatesCollapsed,
      districtsEncountered: [...districts].sort(),
      issues,
    },
  };
}
