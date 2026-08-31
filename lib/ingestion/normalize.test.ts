import { describe, expect, it } from "vitest";

import type { OfficialCsvResource } from "./official-sources";
import {
  filterOfficialPharmaciesByDistrict,
  normalizeCyprusPhone,
  normalizeCyprusPhoneField,
  normalizeCyprusPhoneValues,
  normalizeOfficialResources,
  parseOfficialDate,
} from "./normalize";

const directory: OfficialCsvResource = {
  id: "directory",
  kind: "pharmacy_directory",
  district: null,
  dataset: "Directory 2026",
  coverageStart: null,
  coverageEnd: null,
  url: "https://example.test/directory.csv",
  filename: "directory.csv",
};

const rota: OfficialCsvResource = {
  id: "duty-paphos",
  kind: "duty_rota",
  district: "Paphos",
  dataset: "Duty 2026",
  coverageStart: "2026-05-01",
  coverageEnd: "2026-09-30",
  url: "https://example.test/duty.csv",
  filename: "duty.csv",
};

const directoryCsv = `District,Reg. No.,Surmame,Name,Address,Additional Address Info,Muniuciplity / Community,PC,Pharmacy Tel. No.,House Tel. No.
Paphos,123,Παπαδοπούλου,Μαρία,"Οδός 1, Πάφος",Κοντά στην αγορά,Πάφος,8010,26999999,0
Nicosia,456,Ιωάννου,Άννα,Οδός 2,,Λευκωσία,1010,22111111,99111111
`;

const dutyCsv = `Date,Day,Reg. No.,Surmame,Name,Address,Additional Address Info,Muniuciplity / Community,Pharmacy Tel. No.,House Tel. No.
31/08/26,Monday,123,Παπαδοπούλου,Μαρία,"Οδός 1, Πάφος",Κοντά στην αγορά,Πάφος,26999999,0
`;

describe("official normalization", () => {
  it("normalizes dates and Cyprus telephone numbers without fabricating missing values", () => {
    expect(parseOfficialDate("31/08/26")).toBe("2026-08-31");
    expect(parseOfficialDate("31/02/26")).toBeNull();
    expect(normalizeCyprusPhone("26 999999")).toBe("+35726999999");
    expect(normalizeCyprusPhone("0")).toBeNull();
    expect(normalizeCyprusPhoneField("99526653\n99526653")).toBe("+35799526653");
    expect(normalizeCyprusPhoneField("99348621\n97417411")).toBeNull();
    expect(normalizeCyprusPhoneValues("22424025 - 22510096")).toEqual([
      "+35722424025",
      "+35722510096",
    ]);
    expect(normalizeCyprusPhoneValues("99318764 97688587")).toEqual([
      "+35799318764",
      "+35797688587",
    ]);
    expect(normalizeCyprusPhoneValues("22429210-22429429")).toEqual([
      "+35722429210",
      "+35722429429",
    ]);
  });

  it("uses registration number as stable identity and produces date-only duty facts", () => {
    const normalized = normalizeOfficialResources(
      [
        { resource: rota, text: dutyCsv },
        { resource: directory, text: directoryCsv },
      ],
      "2026-08-31T12:00:00.000Z",
    );

    expect(normalized.report).toMatchObject({
      recordsRead: 3,
      pharmaciesPrepared: 2,
      dutyAssignmentsPrepared: 1,
      recordsSkipped: 0,
      malformedRecords: 0,
    });
    expect(normalized.pharmacies[0]).toMatchObject({
      officialRegistrationNumber: "123",
      pharmacistGivenName: "Μαρία",
      district: "Paphos",
      latitude: null,
      longitude: null,
    });
    expect(normalized.dutyAssignments).toEqual([
      expect.objectContaining({
        pharmacyRegistrationNumber: "123",
        dutyDate: "2026-08-31",
        sourceRecordIdentifier: "duty:duty-paphos:2026-08-31:123",
      }),
    ]);
    expect(normalized.dutyAssignments[0]).not.toHaveProperty("serviceMode");
  });

  it("is deterministic for repeated input and supports district filtering", () => {
    const first = normalizeOfficialResources(
      [
        { resource: directory, text: directoryCsv },
        { resource: rota, text: dutyCsv },
      ],
      "2026-08-31T12:00:00.000Z",
    );
    const second = normalizeOfficialResources(
      [
        { resource: directory, text: directoryCsv },
        { resource: rota, text: dutyCsv },
      ],
      "2026-08-31T12:00:00.000Z",
    );

    expect(second).toEqual(first);
    expect(filterOfficialPharmaciesByDistrict(first.pharmacies, "paphos")).toHaveLength(1);
  });

  it("collapses repeated multiline phone values and reports genuinely ambiguous values", () => {
    const repeatedPhone = directoryCsv.replace(
      "Paphos,123,Παπαδοπούλου,Μαρία,\"Οδός 1, Πάφος\",Κοντά στην αγορά,Πάφος,8010,26999999,0",
      "Paphos,123,Παπαδοπούλου,Μαρία,\"Οδός 1, Πάφος\",Κοντά στην αγορά,Πάφος,8010,26999999,\"99111111\n99111111\"",
    );
    const repeated = normalizeOfficialResources(
      [{ resource: directory, text: repeatedPhone }],
      "2026-08-31T12:00:00.000Z",
    );
    expect(repeated.pharmacies[0].housePhoneE164).toBe("+35799111111");
    expect(repeated.pharmacies[0].housePhoneRaw).toBe("99111111\n99111111");
    expect(repeated.pharmacies[0].housePhoneE164Values).toEqual(["+35799111111"]);
    expect(repeated.report.issues).toHaveLength(0);

    const ambiguousPhone = repeatedPhone.replace("99111111\n99111111", "99111111\n99222222");
    const ambiguous = normalizeOfficialResources(
      [{ resource: directory, text: ambiguousPhone }],
      "2026-08-31T12:00:00.000Z",
    );
    expect(ambiguous.pharmacies[0].housePhoneE164).toBeNull();
    expect(ambiguous.pharmacies[0].housePhoneRaw).toBe("99111111\n99222222");
    expect(ambiguous.pharmacies[0].housePhoneE164Values).toEqual([
      "+35799111111",
      "+35799222222",
    ]);
    expect(ambiguous.report).toMatchObject({
      pharmaciesPrepared: 2,
      recordsSkipped: 0,
      malformedRecords: 0,
    });
    expect(ambiguous.report.issues).toEqual([
      expect.objectContaining({ severity: "warning", rowNumber: 2 }),
    ]);
  });

  it("skips malformed rows and reports them", () => {
    const malformed = directoryCsv.replace("Paphos,123", "Paphos,not-a-number");
    const normalized = normalizeOfficialResources(
      [{ resource: directory, text: malformed }],
      "2026-08-31T12:00:00.000Z",
    );

    expect(normalized.report).toMatchObject({ recordsSkipped: 1, malformedRecords: 1 });
    expect(normalized.report.issues[0]).toMatchObject({ severity: "skipped", rowNumber: 2 });
  });
});
