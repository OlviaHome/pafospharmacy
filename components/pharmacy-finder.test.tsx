// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Pharmacy } from "@/lib/domain/types";

import { PharmacyFinder } from "./pharmacy-finder";

const generatedAt = "2026-09-01T10:00:00.000Z";

function pharmacy(
  id: string,
  overrides: Partial<Pharmacy> = {},
): Pharmacy {
  return {
    id,
    name: `Pharmacy ${id}`,
    addressLine: "1 Test Street",
    addressAdditional: null,
    locality: "Paphos",
    district: "Paphos",
    postalCode: "8010",
    latitude: 34.77,
    longitude: 32.42,
    geocodeProvider: "test",
    geocodeResultIdentifier: `test-result-${id}`,
    geocodeQuery: "1 Test Street, Paphos",
    geocodeQuality: "high",
    geocodedAt: generatedAt,
    phoneE164: "+35726000000",
    officialRegistrationNumber: id,
    pharmacistGivenName: "Test",
    pharmacistSurname: "Pharmacist",
    source: "test",
    sourceDataset: null,
    sourceResourceUrl: null,
    sourceRetrievedAt: null,
    intervals: [],
    dutyAssignments: [
      {
        id: `duty-${id}`,
        pharmacyId: id,
        dutyDate: "2026-09-01",
        sourceDataset: "test-duty",
        sourceRecordIdentifier: `test-duty-${id}`,
        sourceResourceUrl: "https://example.test/duty.csv",
        sourceRetrievedAt: generatedAt,
      },
    ],
    ...overrides,
  };
}

function renderFinder(pharmacies: Pharmacy[], now = generatedAt) {
  return render(
    <PharmacyFinder
      pharmacies={pharmacies}
      source="official_snapshot"
      generatedAt={now}
      ordinaryOpeningDataAvailable={false}
      attribution={null}
      coordinateAttributions={[]}
    />,
  );
}

function installGeolocation(
  latitude = 34.77,
  longitude = 32.42,
) {
  const getCurrentPosition = vi.fn((success: PositionCallback) => {
    success({
      coords: { latitude, longitude },
    } as GeolocationPosition);
  });
  Object.defineProperty(window.navigator, "geolocation", {
    configurable: true,
    value: { getCurrentPosition },
  });
  return getCurrentPosition;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(window.navigator, "geolocation");
});

describe("PharmacyFinder location controls", () => {
  it("renders GPS, manual search, complete no-origin browse, and standard tel call paths", () => {
    const publicPharmacy = Object.assign(pharmacy("1"), {
      housePhoneRaw: "PRIVATE-HOUSE-99111111",
      housePhoneE164: "+35799111111",
      housePhoneE164Values: ["+35799111111"],
    });
    const markup = renderToStaticMarkup(
      <PharmacyFinder
        pharmacies={[publicPharmacy]}
        source="official_snapshot"
        generatedAt={generatedAt}
        ordinaryOpeningDataAvailable={false}
        attribution={null}
        coordinateAttributions={[]}
      />,
    );

    expect(markup).toContain("Find pharmacies near you");
    expect(markup).toContain("Use my location");
    expect(markup).toContain("Enter area or address");
    expect(markup).toContain(
      "You can also browse all pharmacies without sharing your location.",
    );
    expect(markup).toContain("Pharmacy 1");
    expect(markup).toContain('href="tel:+35726000000"');
    expect(markup).not.toContain("facetime:");
    expect(markup).not.toContain("facetime-audio:");
    expect(markup).not.toContain("PRIVATE-HOUSE-99111111");
    expect(markup).not.toContain("+35799111111");
  });

  it("keeps a GPS origin and distance when switching to On Duty", () => {
    installGeolocation();
    renderFinder([pharmacy("gps")]);

    fireEvent.click(screen.getByRole("button", { name: "Use my location" }));
    fireEvent.click(screen.getByRole("button", { name: "On Duty" }));

    expect(screen.getByText("Your location")).toBeTruthy();
    expect(screen.getByText(/^≈ /)).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "On Duty" }).getAttribute("aria-pressed"),
    ).toBe("true");
  });

  it("keeps a manually selected origin and distance when switching to On Duty", async () => {
    const getCurrentPosition = installGeolocation();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          suggestions: [
            {
              label: "Peyia centre, Paphos, Cyprus",
              latitude: 34.88,
              longitude: 32.38,
              resultIdentifier: "peyia-centre",
            },
          ],
        }),
      }),
    );
    renderFinder([pharmacy("manual", { latitude: 34.881, longitude: 32.381 })]);

    fireEvent.click(screen.getByRole("button", { name: "Enter area or address" }));
    fireEvent.change(
      screen.getByLabelText("Hotel, area, landmark, or address in Paphos"),
      { target: { value: "Peyia" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Peyia centre, Paphos, Cyprus",
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "On Duty" }));

    expect(screen.getByText("Peyia centre, Paphos, Cyprus")).toBeTruthy();
    expect(screen.getByText(/^≈ /)).toBeTruthy();
    expect(getCurrentPosition).not.toHaveBeenCalled();
  });

  it("sorts duty pharmacies nearest-first and leaves unknown coordinates last", () => {
    installGeolocation();
    renderFinder([
      pharmacy("far", { latitude: 35.03, longitude: 32.42 }),
      pharmacy("unknown", { latitude: null, longitude: null }),
      pharmacy("near", { latitude: 34.771, longitude: 32.421 }),
    ]);

    fireEvent.click(screen.getByRole("button", { name: "Use my location" }));
    fireEvent.click(screen.getByRole("button", { name: "On Duty" }));

    expect(
      screen
        .getAllByRole("heading", { level: 3 })
        .map((heading) => heading.textContent),
    ).toEqual(["Pharmacy near", "Pharmacy far", "Pharmacy unknown"]);
    expect(screen.getAllByText(/^≈ /)).toHaveLength(2);
  });

  it("keeps the normal duty order when no search origin exists", () => {
    renderFinder([
      pharmacy("far", { latitude: 35.03, longitude: 32.42 }),
      pharmacy("unknown", { latitude: null, longitude: null }),
      pharmacy("near", { latitude: 34.771, longitude: 32.421 }),
    ]);

    fireEvent.click(screen.getByRole("button", { name: "On Duty" }));

    expect(
      screen
        .getAllByRole("heading", { level: 3 })
        .map((heading) => heading.textContent),
    ).toEqual(["Pharmacy far", "Pharmacy unknown", "Pharmacy near"]);
    expect(screen.queryAllByText(/^≈ /)).toHaveLength(0);
  });

  it("does not request location again when filters or days change", () => {
    const getCurrentPosition = installGeolocation();
    renderFinder([pharmacy("permission")]);

    fireEvent.click(screen.getByRole("button", { name: "Use my location" }));
    fireEvent.click(screen.getByRole("button", { name: "On Duty" }));
    fireEvent.click(screen.getByRole("button", { name: "All" }));
    fireEvent.click(screen.getByRole("button", { name: "Tomorrow" }));
    fireEvent.click(screen.getByRole("button", { name: "On Duty" }));
    fireEvent.click(screen.getByRole("button", { name: "Today" }));

    expect(getCurrentPosition).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Your location")).toBeTruthy();
  });
});

describe("PharmacyFinder official duty hours", () => {
  it("shows a current mandatory duty-open period as open", () => {
    renderFinder([pharmacy("open")], "2026-09-01T11:00:00.000Z");

    expect(screen.getByText("OPEN NOW")).toBeTruthy();
    expect(screen.getByText("ON DUTY TODAY")).toBeTruthy();
    expect(screen.getByText("Duty pharmacy — open until 16:00")).toBeTruthy();
    expect(screen.getByText("13:30–16:00")).toBeTruthy();
    expect(screen.getByText("19:30–23:00")).toBeTruthy();
    expect(
      screen.getByText(
        /Open Now is based on the official Cyprus regular pharmacy schedule and official duty rota/,
      ),
    ).toBeTruthy();
  });

  it("keeps a scheduled gap on duty without labelling it open", () => {
    renderFinder([pharmacy("gap")], "2026-09-01T04:00:00.000Z");

    expect(screen.getByText("ON DUTY TODAY")).toBeTruthy();
    expect(
      screen.getByText("Mandatory duty opening starts at 13:30."),
    ).toBeTruthy();
    expect(screen.queryByText("OPEN NOW")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Open Now" }));
    expect(screen.getByText("No pharmacies match this filter")).toBeTruthy();
  });

  it("carries the previous assignment overnight into the current On Duty view", () => {
    renderFinder([pharmacy("overnight")], "2026-09-01T21:30:00.000Z");

    expect(screen.getAllByText("ON DUTY — CALL PHARMACIST").length).toBeGreaterThan(0);
    expect(
      screen.getByText(
        "23:00–08:00: pharmacist available by phone for prescriptions",
      ),
    ).toBeTruthy();
    expect(screen.queryByText("OPEN NOW")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "On Duty" }));
    expect(screen.getByRole("heading", { name: "Pharmacy overnight" })).toBeTruthy();
  });

  it("ends previous-day overnight coverage at exactly 08:00", () => {
    renderFinder([pharmacy("ended")], "2026-09-02T05:00:00.000Z");

    fireEvent.click(screen.getByRole("button", { name: "On Duty" }));
    expect(screen.getByText("No pharmacies match this filter")).toBeTruthy();
  });
});

describe("PharmacyFinder official regular hours", () => {
  it("shows a regular-schedule pharmacy as open with its closing time", () => {
    renderFinder(
      [pharmacy("ordinary-open", { dutyAssignments: [] })],
      "2026-08-31T07:00:00.000Z",
    );

    expect(screen.getByText("OPEN NOW")).toBeTruthy();
    expect(screen.getByText("Regular schedule · until 13:30")).toBeTruthy();
    expect(screen.queryByText("ON DUTY TODAY")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Open Now" }));
    expect(screen.getByRole("heading", { name: "Pharmacy ordinary-open" })).toBeTruthy();
  });

  it("shows the summer afternoon break and excludes it from Open Now", () => {
    renderFinder(
      [pharmacy("ordinary-break", { dutyAssignments: [] })],
      "2026-08-31T11:30:00.000Z",
    );

    expect(screen.getByText("CLOSED")).toBeTruthy();
    expect(screen.getByText("Afternoon break · reopens at 16:00")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Open Now" }));
    expect(screen.getByText("No pharmacies match this filter")).toBeTruthy();
  });

  it("shows regular hours ended after the ordinary closing time", () => {
    renderFinder(
      [pharmacy("ordinary-ended", { dutyAssignments: [] })],
      "2026-08-31T17:30:00.000Z",
    );

    expect(screen.getByText("CLOSED")).toBeTruthy();
    expect(screen.getByText("Regular hours ended")).toBeTruthy();
  });

  it("keeps a Sunday ordinary pharmacy closed while a duty pharmacy is open", () => {
    const sundayDuty = pharmacy("sunday-duty", {
      dutyAssignments: [
        {
          ...pharmacy("source").dutyAssignments[0],
          id: "sunday-duty-assignment",
          pharmacyId: "sunday-duty",
          dutyDate: "2026-09-06",
        },
      ],
    });
    renderFinder(
      [pharmacy("sunday-ordinary", { dutyAssignments: [] }), sundayDuty],
      "2026-09-06T09:00:00.000Z",
    );

    expect(screen.getAllByText("CLOSED")).toHaveLength(1);
    expect(screen.getByText("Closed by regular schedule")).toBeTruthy();
    expect(screen.getAllByText("OPEN NOW")).toHaveLength(1);
    expect(screen.getByText("Duty pharmacy — open until 23:00")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Open Now" }));
    expect(screen.getByRole("heading", { name: "Pharmacy sunday-duty" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Pharmacy sunday-ordinary" })).toBeNull();
  });

  it("keeps registration 607 call, coordinates, and Directions unchanged", () => {
    renderFinder([
      pharmacy("607", {
        dutyAssignments: [],
        latitude: 34.7565252,
        longitude: 32.4164677,
        phoneE164: "+35726938784",
      }),
    ]);

    expect(screen.getByRole("link", { name: "Call" }).getAttribute("href")).toBe(
      "tel:+35726938784",
    );
    expect(screen.getByRole("link", { name: "Directions" }).getAttribute("href")).toBe(
      "https://www.google.com/maps/search/?api=1&query=34.7565252%2C32.4164677",
    );
  });
});
