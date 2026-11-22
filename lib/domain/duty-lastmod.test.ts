import { describe, expect, it } from "vitest";

import type { Pharmacy } from "./types";
import { dutyRosterLastmodByDistrict } from "./duty-lastmod";

type DutyPharmacy = Pick<Pharmacy, "id" | "district" | "dutyAssignments">;

function pharmacy(id: string, district: string, dates: string[]): DutyPharmacy {
  return {
    id,
    district,
    dutyAssignments: dates.map((dutyDate) => ({
      id: `${id}-${dutyDate}`,
      pharmacyId: id,
      dutyDate,
      sourceDataset: "test",
      sourceRecordIdentifier: id,
      sourceResourceUrl: "https://example.test",
      sourceRetrievedAt: "2026-11-01T00:00:00Z",
    })),
  };
}

describe("dutyRosterLastmodByDistrict", () => {
  it("marks only districts where the roster actually changed", () => {
    const changed = dutyRosterLastmodByDistrict(
      [
        pharmacy("p1", "Paphos", ["2026-11-21"]),
        pharmacy("p2", "Paphos", ["2026-11-22"]),
        pharmacy("l1", "Limassol", ["2026-11-21", "2026-11-22"]),
        pharmacy("n1", "Nicosia", ["2026-11-21"]),
      ],
      new Date("2026-11-22T13:45:00Z"),
    );
    expect(changed.get("Paphos")?.toISOString()).toBe("2026-11-21T22:00:00.000Z");
    expect(changed.get("Nicosia")?.toISOString()).toBe("2026-11-21T22:00:00.000Z");
    expect(changed.has("Limassol")).toBe(false);
  });

  it("does not invent an update when no duty schedule is available", () => {
    const changed = dutyRosterLastmodByDistrict(
      [pharmacy("p1", "Paphos", []), pharmacy("n1", "Nicosia", ["2026-11-25"])],
      new Date("2026-11-22T10:00:00Z"),
    );
    expect(changed.size).toBe(0);
  });

  it("uses the Cyprus midnight after the spring DST switch", () => {
    const changed = dutyRosterLastmodByDistrict(
      [
        pharmacy("p1", "Paphos", ["2027-03-28"]),
        pharmacy("p2", "Paphos", ["2027-03-29"]),
      ],
      new Date("2027-03-28T22:30:00Z"),
    );
    expect(changed.get("Paphos")?.toISOString()).toBe("2027-03-28T21:00:00.000Z");
  });
});
