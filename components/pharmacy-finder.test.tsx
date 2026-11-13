// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Pharmacy } from "@/lib/domain/types";
import { ar } from "@/lib/i18n/locales/ar";
import { el } from "@/lib/i18n/locales/el";
import { en } from "@/lib/i18n/locales/en";
import { ru } from "@/lib/i18n/locales/ru";
import type { TranslationDictionary } from "@/lib/i18n/types";

import { PharmacyFinder } from "./pharmacy-finder";

vi.mock("next/navigation", () => ({
  usePathname: () => "/en",
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: vi.fn(), prefetch: vi.fn() }),
}));

const generatedAt = "2026-09-01T10:00:00.000Z";
const locationIntroStorageKey = "pharmacy_location_intro_v1";
const supportedDistricts = [
  "Nicosia",
  "Limassol",
  "Larnaca",
  "Famagusta",
  "Paphos",
] as const;

beforeEach(() => {
  const values = new Map<string, string>();
  const localStorage = {
    get length() {
      return values.size;
    },
    clear: vi.fn(() => values.clear()),
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    key: vi.fn((index: number) => [...values.keys()][index] ?? null),
    removeItem: vi.fn((key: string) => values.delete(key)),
    setItem: vi.fn((key: string, value: string) => values.set(key, value)),
  } satisfies Storage;

  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: localStorage,
  });
  window.localStorage.setItem(
    locationIntroStorageKey,
    JSON.stringify({ version: 1, shownAt: new Date().toISOString() }),
  );
});

function expectPageText(text: string) {
  expect(document.body.textContent).toContain(text);
}

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
  window.localStorage.setItem(
    locationIntroStorageKey,
    JSON.stringify({ version: 1, shownAt: new Date().toISOString() }),
  );
  return render(
    <PharmacyFinder
      pharmacies={pharmacies}
      source="official_snapshot"
      generatedAt={now}
      ordinaryOpeningDataAvailable={false}
      attribution={null}
      coordinateAttributions={[]}
      locale="en"
      messages={en.finder}
      languageLabel={en.languageSelectorLabel}
    />,
  );
}

function renderLocalizedFinder(
  dictionary: TranslationDictionary,
  pharmacies: Pharmacy[],
  now = generatedAt,
) {
  window.localStorage.setItem(
    locationIntroStorageKey,
    JSON.stringify({ version: 1, shownAt: new Date().toISOString() }),
  );
  return render(
    <div lang={dictionary.locale} dir={dictionary.locale === "ar" ? "rtl" : "ltr"}>
      <PharmacyFinder
        pharmacies={pharmacies}
        source="official_snapshot"
        generatedAt={now}
        ordinaryOpeningDataAvailable={false}
        attribution={null}
        coordinateAttributions={[]}
        locale={dictionary.locale}
        messages={dictionary.finder}
        languageLabel={dictionary.languageSelectorLabel}
      />
    </div>,
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
  vi.restoreAllMocks();
  Reflect.deleteProperty(window.navigator, "geolocation");
  Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView");
  window.localStorage.clear();
  vi.useRealTimers();
});

describe("PharmacyFinder location introduction", () => {
  function renderIntroFinder(dictionary: TranslationDictionary = en) {
    return render(
      <div lang={dictionary.locale} dir={dictionary.locale === "ar" ? "rtl" : "ltr"}>
        <PharmacyFinder
          pharmacies={[pharmacy(`${dictionary.locale}-intro`)]}
          source="official_snapshot"
          generatedAt={generatedAt}
          ordinaryOpeningDataAvailable={false}
          attribution={null}
          coordinateAttributions={[]}
          locale={dictionary.locale}
          messages={dictionary.finder}
          languageLabel={dictionary.languageSelectorLabel}
        />
      </div>,
    );
  }

  function renderFirstVisit(dictionary: TranslationDictionary = en) {
    window.localStorage.removeItem(locationIntroStorageKey);
    return renderIntroFinder(dictionary);
  }

  it("shows once, stores a dated marker, and stays hidden on reload", async () => {
    const firstRender = renderFirstVisit();

    expect(
      await screen.findByRole("dialog", { name: en.finder.locationIntroTitle }),
    ).toBeTruthy();
    const marker = JSON.parse(
      window.localStorage.getItem(locationIntroStorageKey) ?? "null",
    ) as { version: number; shownAt: string };
    expect(marker.version).toBe(1);
    expect(Number.isFinite(new Date(marker.shownAt).getTime())).toBe(true);

    firstRender.unmount();
    renderIntroFinder();
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });
  });

  it("shows again when the marker is older than six calendar months", async () => {
    const staleDate = new Date();
    staleDate.setUTCMonth(staleDate.getUTCMonth() - 7);
    window.localStorage.setItem(
      locationIntroStorageKey,
      JSON.stringify({ version: 1, shownAt: staleDate.toISOString() }),
    );
    renderIntroFinder();

    expect(
      await screen.findByRole("dialog", { name: en.finder.locationIntroTitle }),
    ).toBeTruthy();
  });

  it("uses the existing location request only after Yes", async () => {
    const getCurrentPosition = installGeolocation();
    renderFirstVisit();
    expect(
      await screen.findByRole("dialog", { name: en.finder.locationIntroTitle }),
    ).toBeTruthy();
    expect(getCurrentPosition).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: en.finder.locationIntroYes }));

    expect(getCurrentPosition).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByText(en.finder.yourLocation)).toBeTruthy();
  });

  it("closes on Later or Escape without requesting location", async () => {
    const getCurrentPosition = installGeolocation();
    const laterRender = renderFirstVisit();
    await screen.findByRole("dialog", { name: en.finder.locationIntroTitle });
    fireEvent.click(screen.getByRole("button", { name: en.finder.locationIntroLater }));
    expect(getCurrentPosition).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();

    laterRender.unmount();
    window.localStorage.removeItem(locationIntroStorageKey);
    renderFirstVisit();
    const dialog = await screen.findByRole("dialog", {
      name: en.finder.locationIntroTitle,
    });
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(getCurrentPosition).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it.each([en, ru, el, ar] as const)(
    "renders localized accessible copy in $locale",
    async (dictionary) => {
      renderFirstVisit(dictionary);
      const dialog = await screen.findByRole("dialog", {
        name: dictionary.finder.locationIntroTitle,
      });
      expect(dialog.closest("[dir]")?.getAttribute("dir")).toBe(
        dictionary.locale === "ar" ? "rtl" : "ltr",
      );
      expect(screen.getByText(dictionary.finder.locationIntroBody)).toBeTruthy();
      expect(
        screen.getByRole("button", { name: dictionary.finder.locationIntroYes }),
      ).toBeTruthy();
      await waitFor(() => {
        expect(document.activeElement).toBe(
          screen.getByRole("button", { name: dictionary.finder.locationIntroYes }),
        );
      });
    },
  );

  it("keeps working when localStorage is unavailable", async () => {
    vi.spyOn(window.localStorage, "getItem").mockImplementation(() => {
      throw new Error("storage blocked");
    });
    vi.spyOn(window.localStorage, "setItem").mockImplementation(() => {
      throw new Error("storage blocked");
    });

    renderFirstVisit();
    expect(
      await screen.findByRole("dialog", { name: en.finder.locationIntroTitle }),
    ).toBeTruthy();
  });
});

describe("PharmacyFinder location controls", () => {
  it("uses independent branding and keeps required attribution lightweight", () => {
    render(
      <PharmacyFinder
        pharmacies={[pharmacy("branding")]}
        source="official_snapshot"
        generatedAt={generatedAt}
        ordinaryOpeningDataAvailable={false}
        attribution={{
          organization: "Cyprus Pharmaceutical Services",
          datasetPage: "https://www.data.gov.cy/en/dataset/817",
          license: "CC BY 4.0",
          licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
          retrievedAt: "2026-08-31T12:28:58.074Z",
          dutyCoverageStart: "2026-05-01",
          dutyCoverageEnd: "2026-09-30",
        }}
        coordinateAttributions={[
          {
            providerId: "openstreetmap_nominatim",
            provider: "OpenStreetMap Nominatim",
            attribution: "© OpenStreetMap contributors",
            attributionUrl: "https://www.openstreetmap.org/copyright",
            license: "ODbL 1.0",
            licenseUrl: "https://opendatacommons.org/licenses/odbl/1-0/",
            policyUrl: "https://operations.osmfoundation.org/policies/nominatim/",
            generatedAt,
          },
          {
            providerId: "geoapify",
            provider: "Geoapify",
            attribution: "Powered by Geoapify",
            attributionUrl: "https://www.geoapify.com/",
            license: "Geoapify Terms",
            licenseUrl: "https://www.geoapify.com/terms-and-conditions/",
            policyUrl: "https://www.geoapify.com/terms-and-conditions/",
            generatedAt,
          },
          {
            providerId: "google_places",
            provider: "Google Places API (New)",
            attribution: "Google Maps",
            attributionUrl: "https://www.google.com/maps",
            license: "Google Maps Platform Terms",
            licenseUrl: "https://cloud.google.com/maps-platform/terms",
            policyUrl: "https://developers.google.com/maps/documentation/places/web-service/policies",
            generatedAt,
          },
        ]}
        locale="en"
        messages={en.finder}
        languageLabel={en.languageSelectorLabel}
      />,
    );

    expect(
      screen.getByRole("heading", {
        level: 2,
        name: /Official duty schedule across Cyprus · 1 Oct 2026 — 30 Apr 2027/,
      }),
    ).toBeTruthy();
    expect(screen.getAllByRole("link", { name: "About" }).length).toBeGreaterThan(0);
    expect(
      screen.getAllByRole("link", { name: "Info" }).length,
    ).toBeGreaterThan(0);
    expect(screen.getByRole("combobox", { name: "Language" })).toBeTruthy();
    expect(screen.queryByText(/Official directory/)).toBeNull();
    expect(screen.getByText(/Published schedules may not reflect exceptional same-day closures/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "CC BY 4.0" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "© OpenStreetMap contributors" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Powered by Geoapify" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Google Maps" })).toBeTruthy();
  });

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
        locale="en"
        messages={en.finder}
        languageLabel={en.languageSelectorLabel}
      />,
    );

    expect(markup).toContain(en.finder.heroTitle);
    expect(markup).toContain("Use my location");
    expect(markup).toContain("District, address, or pharmacy name");
    expect(markup).not.toContain("You can also browse all pharmacies without sharing your location.");
    expect(markup).toContain("Pharmacy 1");
    expect(markup).toContain('href="tel:+35726000000"');
    expect(markup).not.toContain("facetime:");
    expect(markup).not.toContain("facetime-audio:");
    expect(markup).not.toContain("PRIVATE-HOUSE-99111111");
    expect(markup).not.toContain("+35799111111");
  });

  it("preserves progressive reveal only for located All results", () => {
    installGeolocation();
    renderFinder(
      Array.from({ length: 12 }, (_, index) =>
        pharmacy(`progressive-${index + 1}`, {
          latitude: 34.77 + index * 0.001,
          longitude: 32.42,
        }),
      ),
    );

    expect(screen.getAllByRole("heading", { level: 3 })).toHaveLength(12);
    fireEvent.click(screen.getByRole("button", { name: "Use my location" }));
    expect(screen.getAllByRole("heading", { level: 3 })).toHaveLength(10);

    fireEvent.click(screen.getByRole("button", { name: "Show all 12 pharmacies" }));
    expect(screen.getAllByRole("heading", { level: 3 })).toHaveLength(12);
  });

  it("preserves explicit unknown-data messaging outside supported schedule coverage", () => {
    renderFinder(
      [pharmacy("unsupported", { dutyAssignments: [] })],
      "2027-01-04T10:00:00.000Z",
    );

    expect(screen.getByText("HOURS UNAVAILABLE")).toBeTruthy();
    expect(screen.getByText("Hours are unavailable for this day.")).toBeTruthy();
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

  it.each([
    [
      en,
      "Distance is measured in a straight line. The actual walking or driving route may be longer.",
    ],
    [
      el,
      "Η απόσταση μετριέται σε ευθεία γραμμή. Η πραγματική διαδρομή με τα πόδια ή με το αυτοκίνητο μπορεί να είναι μεγαλύτερη.",
    ],
    [
      ru,
      "Расстояние указано по прямой. Фактический маршрут пешком или на машине может быть длиннее.",
    ],
    [
      ar,
      "تُقاس المسافة بخط مستقيم. قد يكون المسار الفعلي سيرًا على الأقدام أو بالسيارة أطول.",
    ],
  ] as const)(
    "discloses straight-line distance in %s",
    (dictionary, disclosure) => {
      installGeolocation();
      renderLocalizedFinder(dictionary, [pharmacy(`${dictionary.locale}-distance`)]);

      fireEvent.click(
        screen.getByRole("button", { name: dictionary.finder.useLocation }),
      );

      expect(screen.getByText(disclosure)).toBeTruthy();
      const distanceValue = screen.getByText(/^≈ /);
      expect(distanceValue.className).toContain("whitespace-nowrap");
      expect(distanceValue.nextElementSibling?.textContent).toContain(
        `·\u00a0${disclosure}`,
      );
    },
  );

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

    fireEvent.change(
      screen.getByLabelText("District, address, or pharmacy name"),
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

  it("keeps pharmacies without coordinates visible and labels distance only when calculable", () => {
    installGeolocation();
    renderFinder([
      pharmacy("known-coordinate", { latitude: 34.771, longitude: 32.421 }),
      pharmacy("unknown-coordinate", { latitude: null, longitude: null }),
    ]);

    fireEvent.click(screen.getByRole("button", { name: "Use my location" }));

    expect(screen.getByRole("heading", { name: "Pharmacy known-coordinate" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Pharmacy unknown-coordinate" })).toBeTruthy();
    const distanceValue = screen.getByText(/^≈ /);
    expect(distanceValue.className).toContain("whitespace-nowrap");
    expect(distanceValue.nextElementSibling?.textContent).toContain(
      "·\u00a0Distance is measured in a straight line.",
    );
    expectPageText(
      "Distance is measured in a straight line. The actual walking or driving route may be longer.",
    );
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

  it("switches the shared pharmacy list and metadata between districts", () => {
    renderFinder([
      pharmacy("paphos"),
      pharmacy("nicosia", {
        district: "Nicosia",
        locality: "Nicosia",
        addressLine: "2 Capital Street",
        dutyAssignments: [],
      }),
    ]);

    expect(screen.getByRole("heading", { name: "Pharmacy paphos" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Pharmacy nicosia" })).toBeNull();
    expect(document.getElementById("results-heading")?.textContent).toContain(
      "Paphos · Tue 1 Sept · 1 pharmacy · 1 on duty",
    );

    fireEvent.click(screen.getByRole("button", { name: "Nicosia" }));

    expect(screen.getByRole("heading", { name: "Pharmacy nicosia" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Pharmacy paphos" })).toBeNull();
    expect(document.getElementById("results-heading")?.textContent).toContain(
      "Nicosia · Tue 1 Sept · 1 pharmacy · 0 on duty",
    );
  });

  it("keeps one non-color selected tab visible in the local scroll region", () => {
    const scrollIntoView = vi.fn();
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: scrollIntoView,
    });
    renderFinder([
      pharmacy("paphos-tab"),
      pharmacy("nicosia-tab", { district: "Nicosia", locality: "Nicosia" }),
    ]);
    scrollIntoView.mockClear();

    fireEvent.click(screen.getByRole("button", { name: "Nicosia" }));

    const selectedTabs = screen
      .getAllByRole("button")
      .filter((button) => button.getAttribute("data-district-tab"))
      .filter((button) => button.getAttribute("aria-pressed") === "true");
    expect(selectedTabs).toHaveLength(1);
    expect(selectedTabs[0].className).toContain("after:h-0.5");
    expect(scrollIntoView).toHaveBeenCalledWith({
      block: "nearest",
      inline: "nearest",
    });
  });

  it.each(supportedDistricts)(
    "keeps list, counts, filters, search, and empty state scoped to %s",
    (selectedDistrict) => {
      renderFinder(
        supportedDistricts.map((district) =>
          pharmacy(district.toLocaleLowerCase("en"), {
            district,
            locality: district,
            addressLine: `${district} unique address`,
          }),
        ),
      );

      fireEvent.click(screen.getByRole("button", { name: selectedDistrict }));
      expect(
        screen.getByRole("button", { name: selectedDistrict }).getAttribute("aria-pressed"),
      ).toBe("true");
      expect(screen.getAllByRole("heading", { level: 3 })).toHaveLength(1);
      expect(
        screen.getByRole("heading", {
          name: `Pharmacy ${selectedDistrict.toLocaleLowerCase("en")}`,
        }),
      ).toBeTruthy();
      expect(document.getElementById("results-heading")?.textContent).toContain(
        `${selectedDistrict} · Tue 1 Sept · 1 pharmacy · 1 on duty`,
      );

      fireEvent.click(screen.getByRole("button", { name: "On Duty" }));
      expect(screen.getAllByRole("heading", { level: 3 })).toHaveLength(1);
      fireEvent.click(screen.getByRole("button", { name: "All" }));
      fireEvent.change(
        screen.getByLabelText("District, address, or pharmacy name"),
        { target: { value: "No pharmacy here" } },
      );
      expect(screen.getByText("No pharmacies match this filter")).toBeTruthy();

      fireEvent.change(
        screen.getByLabelText("District, address, or pharmacy name"),
        { target: { value: `${selectedDistrict} unique` } },
      );
      expect(
        screen.getByRole("heading", {
          name: `Pharmacy ${selectedDistrict.toLocaleLowerCase("en")}`,
        }),
      ).toBeTruthy();

      fireEvent.click(screen.getByRole("button", { name: "Tomorrow" }));
      expect(document.getElementById("results-heading")?.textContent).toContain(
        `${selectedDistrict} · Wed 2 Sept · 1 pharmacy · 0 on duty`,
      );
    },
  );

  it("clears a selected manual origin when the district changes", async () => {
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
    renderFinder([
      pharmacy("paphos-origin"),
      pharmacy("limassol-origin", {
        district: "Limassol",
        locality: "Limassol",
      }),
    ]);

    fireEvent.change(screen.getByLabelText("District, address, or pharmacy name"), {
      target: { value: "Peyia" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    fireEvent.click(
      await screen.findByRole("button", { name: "Peyia centre, Paphos, Cyprus" }),
    );
    expect(screen.getByText("Peyia centre, Paphos, Cyprus")).toBeTruthy();
    expect(screen.getByText(/^≈ /)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Limassol" }));

    expect(screen.queryByText("Peyia centre, Paphos, Cyprus")).toBeNull();
    expect(screen.queryByText(/^≈ /)).toBeNull();
  });

  it("preserves a GPS origin when the district changes", () => {
    const getCurrentPosition = installGeolocation();
    renderFinder([
      pharmacy("paphos-gps"),
      pharmacy("nicosia-gps", {
        district: "Nicosia",
        locality: "Nicosia",
        latitude: 35.18,
        longitude: 33.38,
      }),
    ]);

    fireEvent.click(screen.getByRole("button", { name: "Use my location" }));
    fireEvent.click(screen.getByRole("button", { name: "Nicosia" }));

    expect(screen.getByText("Your location")).toBeTruthy();
    expect(screen.getByText(/^≈ /)).toBeTruthy();
    expect(getCurrentPosition).toHaveBeenCalledTimes(1);
  });

  it("cancels a pending manual lookup and re-evaluates retained query text", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    renderFinder([
      pharmacy("paphos-query", { name: "Harbour Pharmacy" }),
      pharmacy("nicosia-query", {
        district: "Nicosia",
        locality: "Nicosia",
        name: "Capital Pharmacy",
      }),
    ]);

    fireEvent.change(screen.getByLabelText("District, address, or pharmacy name"), {
      target: { value: "Harbour" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    fireEvent.click(screen.getByRole("button", { name: "Nicosia" }));
    await vi.advanceTimersByTimeAsync(500);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(
      (screen.getByLabelText("District, address, or pharmacy name") as HTMLInputElement)
        .value,
    ).toBe("Harbour");
    expect(screen.getByText("No pharmacies match this filter")).toBeTruthy();
    vi.useRealTimers();
  });

  it("clears visible manual suggestions and errors on district change", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          suggestions: [
            {
              label: "Paphos Harbour",
              latitude: 34.75,
              longitude: 32.41,
              resultIdentifier: "paphos-harbour",
            },
          ],
        }),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 503,
        json: async () => ({}),
      });
    vi.stubGlobal("fetch", fetchMock);
    renderFinder([
      pharmacy("paphos-state"),
      pharmacy("limassol-state", { district: "Limassol", locality: "Limassol" }),
    ]);

    fireEvent.change(screen.getByLabelText("District, address, or pharmacy name"), {
      target: { value: "Paphos Harbour" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    expect(await screen.findByRole("button", { name: "Paphos Harbour" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Limassol" }));
    expect(screen.queryByRole("button", { name: "Paphos Harbour" })).toBeNull();

    fireEvent.change(screen.getByLabelText("District, address, or pharmacy name"), {
      target: { value: "Limassol Marina" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    expect(await screen.findByText("Location search is temporarily unavailable.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Nicosia" }));
    expect(
      screen.queryByText("Location search is temporarily unavailable."),
    ).toBeNull();
  });

  it("resets progressive reveal when changing districts", () => {
    installGeolocation();
    const pharmacies = supportedDistricts
      .filter((district) => district === "Paphos" || district === "Limassol")
      .flatMap((district) =>
        Array.from({ length: 12 }, (_, index) =>
          pharmacy(`${district}-${index + 1}`, {
            district,
            locality: district,
            latitude: 34.7 + index * 0.001,
            longitude: 32.4,
          }),
        ),
      );
    renderFinder(pharmacies);

    fireEvent.click(screen.getByRole("button", { name: "Use my location" }));
    fireEvent.click(screen.getByRole("button", { name: "Show all 12 pharmacies" }));
    expect(screen.getAllByRole("heading", { level: 3 })).toHaveLength(12);
    fireEvent.click(screen.getByRole("button", { name: "Limassol" }));
    expect(screen.getAllByRole("heading", { level: 3 })).toHaveLength(10);
  });

  it("filters the selected district immediately from the unified search field", () => {
    renderFinder([
      pharmacy("harbour", { name: "Harbour Pharmacy" }),
      pharmacy("village", { name: "Village Pharmacy", locality: "Peyia" }),
    ]);

    fireEvent.change(screen.getByLabelText("District, address, or pharmacy name"), {
      target: { value: "Peyia" },
    });

    expect(screen.getByRole("heading", { name: "Village Pharmacy" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Harbour Pharmacy" })).toBeNull();
  });

  it("sends the selected district with manual location searches", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ suggestions: [] }),
    });
    vi.stubGlobal("fetch", fetchMock);
    renderFinder([
      pharmacy("paphos"),
      pharmacy("limassol", { district: "Limassol", locality: "Limassol" }),
    ]);

    fireEvent.click(screen.getByRole("button", { name: "Limassol" }));
    fireEvent.change(screen.getByLabelText("District, address, or pharmacy name"), {
      target: { value: "Makariou Avenue" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    expect(JSON.parse(fetchMock.mock.calls[0][1].body as string)).toEqual({
      query: "Makariou Avenue",
      district: "Limassol",
    });
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
    expectPageText("ON DUTY TODAY · UNTIL 23:00");
    expectPageText("After 23:00, urgent prescriptions are handled by phone until 08:00.");
    expectPageText("Open: 08:00–23:00");
  });

  it("keeps a scheduled gap on duty without labelling it open", () => {
    renderFinder([pharmacy("gap")], "2026-09-01T04:00:00.000Z");

    expectPageText("ON DUTY TODAY · UNTIL 23:00");
    expectPageText("Open: 08:00–23:00");
    expect(screen.queryByText("OPEN NOW")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Open Now" }));
    expect(screen.getByText("No pharmacies match this filter")).toBeTruthy();
  });

  it("carries the previous assignment overnight into the current On Duty view", () => {
    renderFinder([pharmacy("overnight")], "2026-09-01T21:30:00.000Z");

    expect(screen.getAllByText("NIGHT DUTY · CALL FIRST").length).toBeGreaterThan(0);
    expectPageText("23:00–08:00 — urgent prescriptions only. Call before visiting.");
    expect(screen.queryByText("OPEN NOW")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "On Duty" }));
    expect(screen.getByRole("heading", { name: "Pharmacy overnight" })).toBeTruthy();
  });

  it("ends previous-day overnight coverage at exactly 08:00", () => {
    renderFinder([pharmacy("ended")], "2026-09-02T05:00:00.000Z");

    fireEvent.click(screen.getByRole("button", { name: "On Duty" }));
    expect(screen.getByText("No pharmacies match this filter")).toBeTruthy();
  });

  it("switches the winter duty UI from daytime duty to night telephone duty at 22:00", () => {
    const winterDuty = pharmacy("winter", {
      dutyAssignments: [
        {
          ...pharmacy("source").dutyAssignments[0],
          id: "winter-duty",
          pharmacyId: "winter",
          dutyDate: "2026-10-01",
        },
      ],
    });

    const before = renderFinder([winterDuty], "2026-10-01T18:59:00.000Z");
    expectPageText("ON DUTY TODAY · UNTIL 22:00");
    expectPageText("After 22:00, urgent prescriptions are handled by phone until 08:00.");
    expect(screen.queryByText("NIGHT DUTY · CALL FIRST")).toBeNull();
    before.unmount();

    renderFinder([winterDuty], "2026-10-01T19:00:00.000Z");
    expect(screen.getAllByText("NIGHT DUTY · CALL FIRST").length).toBeGreaterThan(0);
    expectPageText("22:00–08:00 — urgent prescriptions only. Call before visiting.");
    expect(screen.queryByText("OPEN NOW")).toBeNull();
  });

  it("does not show duty labels without an official assignment", () => {
    renderFinder(
      [pharmacy("unassigned", { dutyAssignments: [] })],
      "2026-10-01T19:00:00.000Z",
    );

    expect(screen.queryByText(/ON DUTY TODAY/)).toBeNull();
    expect(screen.queryByText("NIGHT DUTY · CALL FIRST")).toBeNull();
  });

  it("shows conflicting source modes as a call-to-confirm state without hiding hours", () => {
    renderFinder([
      pharmacy("conflict", {
        dutyAssignments: [],
        intervals: [
          {
            id: "conflict-ordinary-open",
            pharmacyId: "conflict",
            startsAt: "2026-09-01T09:00:00.000Z",
            endsAt: "2026-09-01T11:00:00.000Z",
            scheduleKind: "ordinary",
            serviceMode: "open",
          },
          {
            id: "conflict-duty-call",
            pharmacyId: "conflict",
            startsAt: "2026-09-01T09:00:00.000Z",
            endsAt: "2026-09-01T11:00:00.000Z",
            scheduleKind: "duty",
            serviceMode: "on_call",
          },
        ],
      }),
    ]);

    expect(screen.getByText(/HOURS CONFLICT — CALL TO CONFIRM/)).toBeTruthy();
    expect(screen.getByText("Today's hours")).toBeTruthy();
    expect(screen.getByText("Recorded regular hours · open")).toBeTruthy();
    expect(screen.getByText("Recorded duty hours · on call")).toBeTruthy();
  });

  it.each([
    [en, "ON DUTY TODAY · UNTIL 22:00", "NIGHT DUTY · CALL FIRST"],
    [el, "ΕΦΗΜΕΡΕΥΕΙ ΣΗΜΕΡΑ · ΕΩΣ ΤΙΣ 22:00", "ΝΥΧΤΕΡΙΝΗ ΕΦΗΜΕΡΙΑ · ΚΑΛΕΣΤΕ ΠΡΩΤΑ"],
    [ru, "ДЕЖУРИТ СЕГОДНЯ · ДО 22:00", "НОЧНОЕ ДЕЖУРСТВО · ПО ЗВОНКУ"],
    [ar, "صيدلية مناوبة اليوم · حتى 22:00", "مناوبة ليلية · اتصل أولاً"],
  ])("renders localized winter duty states", (dictionary, daytimeLabel, nightLabel) => {
    const localizedDuty = pharmacy(`winter-${dictionary.locale}`, {
      dutyAssignments: [
        {
          ...pharmacy("source").dutyAssignments[0],
          id: `winter-duty-${dictionary.locale}`,
          pharmacyId: `winter-${dictionary.locale}`,
          dutyDate: "2026-10-01",
        },
      ],
    });
    const daytime = renderLocalizedFinder(
      dictionary,
      [localizedDuty],
      "2026-10-01T18:59:00.000Z",
    );
    expectPageText(daytimeLabel);
    if (dictionary.locale === "ar") {
      expect(daytime.container.firstElementChild?.getAttribute("dir")).toBe("rtl");
    }
    daytime.unmount();

    renderLocalizedFinder(dictionary, [localizedDuty], "2026-10-01T19:00:00.000Z");
    expect(screen.getAllByText(nightLabel).length).toBeGreaterThan(0);
  });

  it.each([
    [en, "ON DUTY · THU 5 NOV · UNTIL 22:00"],
    [el, "ΣΕ ΕΦΗΜΕΡΙΑ · ΠΕΜ 5 ΝΟΕ · ΕΩΣ ΤΙΣ 22:00"],
    [ru, "ДЕЖУРНАЯ АПТЕКА · ЧТ 5 НОЯБ. · ДО 22:00"],
    [ar, "في المناوبة · الخميس 5 نوفمبر · حتى 22:00"],
  ])("shows a localized dated tomorrow duty badge in $locale", (dictionary, badge) => {
    const tomorrowDuty = pharmacy(`tomorrow-duty-${dictionary.locale}`, {
      dutyAssignments: [
        {
          ...pharmacy("source").dutyAssignments[0],
          id: `tomorrow-duty-${dictionary.locale}`,
          pharmacyId: `tomorrow-duty-${dictionary.locale}`,
          dutyDate: "2026-11-05",
        },
      ],
    });

    renderLocalizedFinder(
      dictionary,
      [tomorrowDuty],
      "2026-11-04T10:00:00.000Z",
    );
    fireEvent.click(screen.getByRole("button", { name: dictionary.finder.tomorrow }));
    fireEvent.click(screen.getByRole("button", { name: dictionary.finder.onDuty }));

    expectPageText(badge);
    expect(screen.queryByText(dictionary.finder.openNowBadge)).toBeNull();
  });
});

describe("PharmacyFinder shared card grid contract", () => {
  it("groups only adjacent cards and exposes complete semantic regions", () => {
    const longOfficialAddress =
      "123 Archbishop Makarios III Avenue, Building Alpha, Ground Floor, Suite 14";
    const { container } = renderFinder([
      pharmacy("all-duty-short"),
      pharmacy("all-duty-long", {
        name: "A Pharmacy With A Substantially Longer Official Registered Name",
        addressLine: longOfficialAddress,
      }),
      pharmacy("mixed-duty"),
      pharmacy("mixed-none", { dutyAssignments: [] }),
      pharmacy("none-short", { dutyAssignments: [] }),
      pharmacy("none-long", {
        dutyAssignments: [],
        addressLine: longOfficialAddress,
      }),
    ]);

    const rows = [...container.querySelectorAll<HTMLElement>("[data-card-row]")];
    expect(rows).toHaveLength(3);
    expect(rows.map((row) => row.querySelectorAll("[data-pharmacy-card]").length))
      .toEqual([2, 2, 2]);

    const cards = [...container.querySelectorAll<HTMLElement>("[data-pharmacy-card]")];
    expect(cards).toHaveLength(6);
    for (const card of cards) {
      expect(card.querySelector('[data-card-region="identity"]')).toBeTruthy();
      expect(card.querySelector('[data-card-panel="hours"]')).toBeTruthy();
      expect(card.querySelector('[data-card-region="proximity"]')).toBeTruthy();
      expect(card.querySelector('[data-card-region="actions"]')).toBeTruthy();
    }

    expect(rows[0].querySelectorAll('[data-card-panel="duty"]')).toHaveLength(2);
    expect(rows[1].querySelectorAll('[data-card-panel="duty"]')).toHaveLength(1);
    expect(rows[2].querySelectorAll('[data-card-panel="duty"]')).toHaveLength(0);
    expect(rows[2].textContent).not.toContain("ON DUTY TODAY");
    expect(screen.getAllByText(new RegExp(longOfficialAddress))).toHaveLength(2);
  });

  it("keeps the natural semantic order for single-column presentation", () => {
    const { container } = renderFinder([pharmacy("semantic-order")]);
    const card = container.querySelector<HTMLElement>("[data-pharmacy-card]");
    expect(card).toBeTruthy();
    expect(
      [...card!.querySelectorAll<HTMLElement>("[data-card-region]")].map(
        (region) => region.dataset.cardRegion,
      ),
    ).toEqual(["identity", "duty", "hours", "proximity", "actions"]);
  });
});

describe("PharmacyFinder official regular hours", () => {
  it("shows a regular-schedule pharmacy as open with today's hours", () => {
    renderFinder(
      [pharmacy("ordinary-open", { dutyAssignments: [] })],
      "2026-08-31T07:00:00.000Z",
    );

    expect(screen.getByText("OPEN NOW")).toBeTruthy();
    expectPageText("Open: 08:00–13:30");
    expectPageText("Open: 16:00–19:30");
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
    expectPageText("Open: 08:00–13:30");
    expectPageText("Open: 16:00–19:30");
    fireEvent.click(screen.getByRole("button", { name: "Open Now" }));
    expect(screen.getByText("No pharmacies match this filter")).toBeTruthy();
  });

  it("shows regular hours ended after the ordinary closing time", () => {
    renderFinder(
      [pharmacy("ordinary-ended", { dutyAssignments: [] })],
      "2026-08-31T17:30:00.000Z",
    );

    expect(screen.getByText("CLOSED")).toBeTruthy();
    expectPageText("Open: 08:00–13:30");
    expectPageText("Open: 16:00–19:30");
  });

  it("shows both source-backed winter Thursday periods as separate opening lines", () => {
    renderFinder(
      [pharmacy("winter-thursday", { dutyAssignments: [] })],
      "2026-11-05T06:00:00.000Z",
    );

    expectPageText("Open: 08:00–13:30");
    expectPageText("Open: 15:00–18:30");
    expect(screen.queryByText("Open: 08:00–18:30")).toBeNull();
  });

  it("does not invent an afternoon period on a source-backed Wednesday", () => {
    renderFinder(
      [pharmacy("winter-wednesday", { dutyAssignments: [] })],
      "2026-11-04T06:00:00.000Z",
    );

    expectPageText("Open: 08:00–13:30");
    expect(screen.queryByText("Open: 15:00–18:30")).toBeNull();
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
    expectPageText("After 23:00, urgent prescriptions are handled by phone until 08:00.");

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

    expect(screen.getByRole("link", { name: "Call: 26 938784" }).getAttribute("href")).toBe(
      "tel:+35726938784",
    );
    expect(screen.getByRole("link", { name: "Directions" }).getAttribute("href")).toBe(
      "https://www.google.com/maps/search/?api=1&query=34.7565252%2C32.4164677",
    );
  });

  it("shows tomorrow's schedule without a live current-time badge", () => {
    renderFinder(
      [pharmacy("tomorrow", { dutyAssignments: [] })],
      "2026-08-31T07:00:00.000Z",
    );

    expect(screen.getByText("OPEN NOW")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Tomorrow" }));

    expect(screen.queryByText("OPEN NOW")).toBeNull();
    expect(screen.getByText("Tomorrow's hours")).toBeTruthy();
    expectPageText("Open: 08:00–13:30");
    expectPageText("Open: 16:00–19:30");
  });

  it.each([
    [en, "Open: 08:00–13:30", "Open: 15:00–18:30"],
    [el, "Ανοικτό: 08:00–13:30", "Ανοικτό: 15:00–18:30"],
    [ru, "Открыто: 08:00–13:30", "Открыто: 15:00–18:30"],
    [ar, "مفتوح: 08:00–13:30", "مفتوح: 15:00–18:30"],
  ])(
    "uses day-neutral multi-period opening lines in $locale",
    (dictionary, morning, afternoon) => {
      renderLocalizedFinder(
        dictionary,
        [pharmacy(`periods-${dictionary.locale}`, { dutyAssignments: [] })],
        "2026-11-05T06:00:00.000Z",
      );

      expectPageText(morning);
      expectPageText(afternoon);
    },
  );
});

describe("PharmacyFinder localization", () => {
  it.each([
    [en, "Info"],
    [el, "Πληροφορίες"],
    [ru, "Информация"],
    [ar, "معلومات"],
  ] as const)("uses the concise information label in $locale", (dictionary, label) => {
    renderLocalizedFinder(dictionary, [pharmacy(`info-${dictionary.locale}`)]);

    expect(screen.getAllByRole("link", { name: label }).length).toBeGreaterThan(0);
    expect(
      screen.getAllByRole("link", { name: label })[0]?.getAttribute("href"),
    ).toBe(`/${dictionary.locale}/data-sources`);
  });

  it.each([en, el, ru, ar])(
    "renders district, summary, status, hours, and action copy in $locale",
    (dictionary) => {
      renderLocalizedFinder(dictionary, [pharmacy(`locale-${dictionary.locale}`)]);

      expect(
        screen.getByRole("button", { name: dictionary.finder.districtNicosia }),
      ).toBeTruthy();
      expect(
        screen.getByRole("button", { name: dictionary.finder.districtLimassol }),
      ).toBeTruthy();
      expect(
        screen.getByRole("button", { name: dictionary.finder.districtLarnaca }),
      ).toBeTruthy();
      expect(
        screen.getByRole("button", { name: dictionary.finder.districtFamagusta }),
      ).toBeTruthy();
      expect(
        screen.getByRole("button", { name: dictionary.finder.districtPaphos }),
      ).toBeTruthy();
      expect(document.getElementById("results-heading")?.textContent).toContain(
        dictionary.finder.districtPaphos,
      );
      expect(screen.getAllByText(dictionary.finder.openNowBadge).length).toBeGreaterThan(0);
      expect(screen.getByText(dictionary.finder.todayHours)).toBeTruthy();
      expect(
        screen.getByRole("link", {
          name: `${dictionary.finder.call}: 26 000000`,
        }),
      ).toBeTruthy();
      expect(screen.getByRole("link", { name: dictionary.finder.directions })).toBeTruthy();
    },
  );

  it.each([en, el, ru, ar])(
    "keeps schedule, Call, and Directions semantics unchanged in $locale",
    (dictionary) => {
      const officialName = "Παναγιώτου Έλενα";
      const officialAddress = "Λεωφόρος Ελλάδος 1";
      renderLocalizedFinder(
        dictionary,
        [
          pharmacy("607", {
            name: officialName,
            addressLine: officialAddress,
            addressAdditional: null,
            locality: "Πάφος",
            latitude: 34.7565252,
            longitude: 32.4164677,
            phoneE164: "+35726938784",
          }),
        ],
        "2026-09-01T11:00:00.000Z",
      );

      expect(screen.getAllByText(dictionary.finder.openNowBadge).length).toBeGreaterThan(0);
      const expectedName = {
        el: "Παναγιώτου Έλενα",
        en: "Panagiotou Elena",
        ru: "Панагиоту Елена",
        ar: "باناغيوتو إلينا",
      }[dictionary.locale];
      const expectedAddress =
        {
          el: "Λεωφόρος Ελλάδος 1, Πάφος 8010",
          en: "Leoforos Ellados 1, Pafos 8010",
          ru: "Леофорос Елладос 1, Пафос 8010",
          ar: "ليوفوروس إللاذوس 1, بافوس 8010",
        }[dictionary.locale];
      expect(screen.getByText(expectedName).textContent).toBe(expectedName);
      expect(screen.getByText(expectedAddress).textContent).toBe(expectedAddress);
      expect(
        screen.getByRole("link", {
          name: `${dictionary.finder.call}: 26 938784`,
        }).getAttribute("href"),
      )
        .toBe("tel:+35726938784");
      expect(
        screen.getByRole("link", { name: dictionary.finder.directions }).getAttribute("href"),
      ).toBe("https://www.google.com/maps/search/?api=1&query=34.7565252%2C32.4164677");
    },
  );

  it("isolates mixed-script official identity and stable numeric values in Arabic", () => {
    const { container } = renderLocalizedFinder(
      ar,
      [pharmacy("mixed", { name: "صيدلية Δοκιμή 607", addressLine: "Οδός 12" })],
    );

    expect(container.firstElementChild?.getAttribute("dir")).toBe("rtl");
    expect(screen.getByText("صيدلية ذوكيمي 607").closest("bdi")?.getAttribute("dir"))
      .toBe("auto");
    const callLink = screen.getByRole("link", { name: `${ar.finder.call}: 26 000000` });
    expect(callLink.getAttribute("href"))
      .toBe("tel:+35726000000");
    expect(screen.getByText("26 000000").closest("bdi")?.getAttribute("dir")).toBe("ltr");
    expect(screen.getByText("08:00–23:00").closest("bdi")?.getAttribute("dir")).toBe("ltr");
  });

  it("keeps the canonical address for directions when coordinates are unavailable", () => {
    renderLocalizedFinder(
      en,
      [
        pharmacy("address-directions", {
          addressLine: "Λεωφόρος Ελλάδος 1",
          addressAdditional: null,
          locality: "Πάφος",
          latitude: null,
          longitude: null,
        }),
      ],
    );

    expect(screen.getByText("Leoforos Ellados 1, Pafos 8010")).toBeTruthy();
    expect(screen.getByRole("link", { name: en.finder.directions }).getAttribute("href"))
      .toBe(
        "https://www.google.com/maps/search/?api=1&query=%CE%9B%CE%B5%CF%89%CF%86%CF%8C%CF%81%CE%BF%CF%82%20%CE%95%CE%BB%CE%BB%CE%AC%CE%B4%CE%BF%CF%82%201%2C%20%CE%A0%CE%AC%CF%86%CE%BF%CF%82%208010",
      );
  });

  it("keeps the safe unavailable-phone state when no phone number exists", () => {
    renderLocalizedFinder(ar, [pharmacy("no-phone", { phoneE164: null })]);

    expect(screen.getByText(ar.finder.phoneUnavailable)).toBeTruthy();
    expect(document.querySelector('a[href^="tel:"]')).toBeNull();
  });

  it.each([
    [en, "Kings Avenue Mall", "Kings Avenue Mall, Paphos, Cyprus"],
    [el, "Κάτω Πάφος", "Κάτω Πάφος, Κύπρος"],
    [ru, "набережная Пафоса", "Набережная Пафоса, Кипр"],
    [ar, "ميناء بافوس", "ميناء بافوس، قبرص"],
  ] as const)(
    "submits and safely renders %s manual-location text",
    async (dictionary, query, label) => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          suggestions: [
            {
              label,
              latitude: 34.75,
              longitude: 32.41,
              resultIdentifier: `${dictionary.locale}-result`,
            },
          ],
        }),
      });
      vi.stubGlobal("fetch", fetchMock);
      renderLocalizedFinder(dictionary, [pharmacy(dictionary.locale)]);

      fireEvent.change(screen.getByLabelText(dictionary.finder.locationInputLabel), {
        target: { value: query },
      });
      fireEvent.click(screen.getByRole("button", { name: dictionary.finder.search }));

      const suggestion = await screen.findByRole("button", { name: label });
      expect(suggestion.querySelector("bdi")?.getAttribute("dir")).toBe("auto");
      expect(JSON.parse(fetchMock.mock.calls[0][1].body as string)).toEqual({
        query,
        district: "Paphos",
      });
    },
  );

  it("uses a localized generic error for an Arabic network failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    renderLocalizedFinder(ar, [pharmacy("ar-error")]);

    fireEvent.change(screen.getByLabelText(ar.finder.locationInputLabel), {
      target: { value: "ميناء بافوس" },
    });
    fireEvent.click(screen.getByRole("button", { name: ar.finder.search }));

    expect(await screen.findByText(ar.finder.searchUnavailable)).toBeTruthy();
    expect(screen.queryByText("Failed to fetch")).toBeNull();
  });

  it.each([en, el, ru, ar])(
    "uses the localized five-minute message for %s client throttling",
    async (dictionary) => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          ok: false,
          status: 429,
          json: async () => ({ code: "client_rate_limited" }),
        }),
      );
      renderLocalizedFinder(dictionary, [pharmacy(`${dictionary.locale}-limit`)]);

      fireEvent.change(screen.getByLabelText(dictionary.finder.locationInputLabel), {
        target: { value: "Paphos harbour" },
      });
      fireEvent.click(screen.getByRole("button", { name: dictionary.finder.search }));

      expect(await screen.findByText(dictionary.finder.searchRateLimited)).toBeTruthy();
    },
  );

  it("keeps global and provider throttling on the generic localized message", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 429,
        json: async () => ({
          error: "Location search is temporarily unavailable. Try again later.",
        }),
      }),
    );
    renderLocalizedFinder(en, [pharmacy("global-limit")]);

    fireEvent.change(screen.getByLabelText(en.finder.locationInputLabel), {
      target: { value: "Paphos harbour" },
    });
    fireEvent.click(screen.getByRole("button", { name: en.finder.search }));

    expect(await screen.findByText(en.finder.searchUnavailable)).toBeTruthy();
    expect(screen.queryByText(en.finder.searchRateLimited)).toBeNull();
  });
});
