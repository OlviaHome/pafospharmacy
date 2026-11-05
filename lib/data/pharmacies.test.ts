import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  clearDataCacheMock,
  createClientMock,
  readFileMock,
  unstableCacheMock,
} = vi.hoisted(() => {
  const dataCache = new Map<string, unknown>();
  return {
    clearDataCacheMock: () => dataCache.clear(),
    createClientMock: vi.fn(),
    readFileMock: vi.fn(),
    unstableCacheMock: vi.fn(
      (
        callback: (...args: unknown[]) => unknown,
        keyParts: string[],
      ) =>
        async (...args: unknown[]) => {
          const key = JSON.stringify([keyParts, args]);
          if (!dataCache.has(key)) {
            dataCache.set(key, await callback(...args));
          }
          return dataCache.get(key);
        },
    ),
  };
});

vi.mock("server-only", () => ({}));
vi.mock("@supabase/supabase-js", () => ({ createClient: createClientMock }));
vi.mock("next/cache", () => ({ unstable_cache: unstableCacheMock }));
vi.mock("node:fs/promises", () => ({ readFile: readFileMock }));

import googlePlaceLinksJson from "@/data/geocoding/paphos-google-place-links-2026.json";
import { PAPHOS_DISPUTED_FALLBACK_REGISTRATION_NUMBERS } from "@/lib/geocoding/google-places";

import {
  getPharmacyDataset,
  PHARMACY_DATA_CACHE_TAG,
} from "./pharmacies";

function supabasePharmacyRow(options: {
  registration: string;
  latitude: number | null;
  longitude: number | null;
  provider: string | null;
  google: Record<string, unknown> | null;
}) {
  return {
    id: Number(options.registration),
    name: `Pharmacy ${options.registration}`,
    address_line: "1 Test Street",
    address_additional: null,
    locality: "Paphos",
    district: "Paphos",
    postal_code: "8010",
    latitude: options.latitude,
    longitude: options.longitude,
    geocode_provider: options.provider,
    geocode_result_identifier: options.provider ? `fallback-${options.registration}` : null,
    geocode_query: options.provider ? "1 Test Street, Paphos, Cyprus" : null,
    geocode_quality: options.provider ? "high" : null,
    geocoded_at: options.provider ? "2026-09-01T00:00:00.000Z" : null,
    phone_e164: "+35726900000",
    house_phone_e164: "+35799111111",
    house_phone_raw: "99111111",
    house_phone_e164_values: ["+35799111111"],
    official_registration_number: options.registration,
    pharmacist_given_name: null,
    pharmacist_surname: null,
    source: "cyprus_open_data",
    source_dataset: "Cyprus private pharmacies directory 2026",
    source_resource_url: "https://example.test/official.csv",
    source_retrieved_at: "2026-08-31T00:00:00.000Z",
    availability_intervals: [],
    duty_assignments: [],
    pharmacy_google_places: options.google,
  };
}

function googleRow(options: {
  registration: string;
  classification: "exact_identity_match" | "probable_match";
  latitude: number | null;
  longitude: number | null;
  expiresAt?: string;
}) {
  return {
    official_registration_number: options.registration,
    place_id: `place-${options.registration}`,
    display_name: null,
    formatted_address: null,
    latitude: options.latitude,
    longitude: options.longitude,
    google_phone_e164: null,
    classification: options.classification,
    matching_evidence: ["phone_exact"],
    retrieved_at: "2026-09-08T00:00:00.000Z",
    expires_at: options.expiresAt ?? "2026-10-08T00:00:00.000Z",
  };
}

function deterministicGoogleCache() {
  return {
    metadata: { generatedAt: "2026-10-07T10:00:00.000Z" },
    records: PAPHOS_DISPUTED_FALLBACK_REGISTRATION_NUMBERS.map(
      (registration, index) => {
        const link = googlePlaceLinksJson.records.find(
          (record) => record.officialRegistrationNumber === registration,
        );
        if (!link || link.classification !== "exact_identity_match") {
          throw new Error(`Missing exact checked-in Google link for ${registration}.`);
        }
        return {
          officialRegistrationNumber: registration,
          placeId: link.placeId,
          displayName: null,
          formattedAddress: null,
          latitude: registration === "607" ? 34.7565252 : 34.7 + index * 0.01,
          longitude: registration === "607" ? 32.4164677 : 32.3 + index * 0.01,
          googlePhoneE164: null,
          classification: "exact_identity_match",
          matchingEvidence: ["deterministic_test_fixture"],
          retrievedAt: "2026-10-07T10:00:00.000Z",
          expiresAt: "2026-11-06T10:00:00.000Z",
        };
      },
    ),
  };
}

function mockSupabaseRead(
  rows: Array<Record<string, unknown>> | null,
  error: { message: string } | null = null,
) {
  const query = {
    select: vi.fn(),
    eq: vi.fn(),
    lt: vi.fn(),
    gt: vi.fn(),
    gte: vi.fn(),
    lte: vi.fn(),
    order: vi.fn(),
  };
  query.select.mockReturnValue(query);
  query.eq.mockReturnValue(query);
  query.lt.mockReturnValue(query);
  query.gt.mockReturnValue(query);
  query.gte.mockReturnValue(query);
  query.lte.mockReturnValue(query);
  query.order.mockResolvedValue({ data: rows, error });
  const from = vi.fn().mockReturnValue(query);
  createClientMock.mockReturnValue({ from });
  return { from, query };
}

beforeEach(() => {
  clearDataCacheMock();
  vi.stubEnv("NODE_ENV", "test");
  vi.stubEnv("SUPABASE_URL", "");
  vi.stubEnv("SUPABASE_PUBLISHABLE_KEY", "");
  createClientMock.mockReset();
  readFileMock.mockReset();
  readFileMock.mockRejectedValue(
    Object.assign(new Error("No local Google cache"), { code: "ENOENT" }),
  );
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("Google Places pharmacy data selection", () => {
  it("prefers only fresh exact Google coordinates and keeps every active district pharmacy", async () => {
    readFileMock.mockResolvedValue(JSON.stringify(deterministicGoogleCache()));
    const dataset = await getPharmacyDataset(new Date("2026-10-08T10:00:00Z"));
    const registration607 = dataset.pharmacies.find(
      (pharmacy) => pharmacy.officialRegistrationNumber === "607",
    );
    const probable433 = dataset.pharmacies.find(
      (pharmacy) => pharmacy.officialRegistrationNumber === "433",
    );

    expect(dataset.pharmacies).toHaveLength(704);
    expect(dataset.pharmacies.filter((pharmacy) => pharmacy.district === "Paphos"))
      .toHaveLength(92);
    expect(new Set(dataset.pharmacies.map((pharmacy) => pharmacy.district))).toEqual(
      new Set(["Nicosia", "Limassol", "Larnaca", "Paphos", "Famagusta"]),
    );
    for (const pharmacy of dataset.pharmacies) {
      expect(pharmacy).not.toHaveProperty("housePhoneE164");
      expect(pharmacy).not.toHaveProperty("housePhoneRaw");
      expect(pharmacy).not.toHaveProperty("housePhoneE164Values");
    }
    expect(
      dataset.pharmacies.filter(
        (pharmacy) => pharmacy.geocodeProvider === "google_places",
      ),
    ).toHaveLength(7);
    expect(
      dataset.pharmacies.filter((pharmacy) => pharmacy.latitude !== null),
    ).toHaveLength(27);
    expect(registration607).toMatchObject({
      latitude: 34.7565252,
      longitude: 32.4164677,
      geocodeProvider: "google_places",
    });
    for (const registration of PAPHOS_DISPUTED_FALLBACK_REGISTRATION_NUMBERS) {
      expect(
        dataset.pharmacies.find(
          (pharmacy) => pharmacy.officialRegistrationNumber === registration,
        )?.geocodeProvider,
      ).toBe("google_places");
    }
    expect(probable433?.geocodeProvider).not.toBe("google_places");
    expect(dataset.coordinateAttributions.map((item) => item.providerId)).toContain(
      "google_places",
    );
  });

  it("falls back to retained enrichment after the Google cache expires", async () => {
    readFileMock.mockResolvedValue(JSON.stringify(deterministicGoogleCache()));
    const dataset = await getPharmacyDataset(new Date("2026-11-08T10:00:00Z"));
    const registration607 = dataset.pharmacies.find(
      (pharmacy) => pharmacy.officialRegistrationNumber === "607",
    );

    expect(
      dataset.pharmacies.filter(
        (pharmacy) => pharmacy.geocodeProvider === "google_places",
      ),
    ).toHaveLength(0);
    expect(
      dataset.pharmacies.filter((pharmacy) => pharmacy.latitude !== null),
    ).toHaveLength(20);
    expect(registration607).toMatchObject({
      latitude: null,
      longitude: null,
      geocodeProvider: null,
    });
    for (const registration of PAPHOS_DISPUTED_FALLBACK_REGISTRATION_NUMBERS) {
      expect(
        dataset.pharmacies.find(
          (pharmacy) => pharmacy.officialRegistrationNumber === registration,
        ),
      ).toMatchObject({
        latitude: null,
        longitude: null,
        geocodeProvider: null,
      });
    }
    expect(dataset.coordinateAttributions.map((item) => item.providerId)).not.toContain(
      "google_places",
    );
  });
});

describe("Supabase runtime pharmacy data", () => {
  it("caches one Supabase read per Cyprus date without freezing request time or coordinate expiry", async () => {
    vi.stubEnv("SUPABASE_URL", "https://project.supabase.co");
    vi.stubEnv("SUPABASE_PUBLISHABLE_KEY", "publishable-test-key");
    const { from } = mockSupabaseRead([
      supabasePharmacyRow({
        registration: "708",
        latitude: 34.7776439,
        longitude: 32.4296431,
        provider: "geoapify",
        google: googleRow({
          registration: "708",
          classification: "exact_identity_match",
          latitude: 34.7775492,
          longitude: 32.4296866,
          expiresAt: "2026-09-09T11:00:00.000Z",
        }),
      }),
    ]);

    const firstNow = new Date("2026-09-09T10:00:00.000Z");
    const laterSameDate = new Date("2026-09-09T12:00:00.000Z");
    const nextDate = new Date("2026-09-10T10:00:00.000Z");
    const first = await getPharmacyDataset(firstNow);
    const later = await getPharmacyDataset(laterSameDate);

    expect(from).toHaveBeenCalledTimes(1);
    expect(first.generatedAt).toBe(firstNow.toISOString());
    expect(later.generatedAt).toBe(laterSameDate.toISOString());
    expect(first.pharmacies[0]).toMatchObject({
      geocodeProvider: "google_places",
      latitude: 34.7775492,
      longitude: 32.4296866,
    });
    expect(later.pharmacies[0]).toMatchObject({
      geocodeProvider: "geoapify",
      latitude: 34.7776439,
      longitude: 32.4296431,
    });

    await getPharmacyDataset(nextDate);
    expect(from).toHaveBeenCalledTimes(2);
    expect(unstableCacheMock).toHaveBeenCalledWith(
      expect.any(Function),
      ["supabase-pharmacy-data-by-cyprus-date"],
      {
        revalidate: 86_400,
        tags: [PHARMACY_DATA_CACHE_TAG],
      },
    );
  });

  it("uses configured Supabase data across districts and applies coordinate trust priority", async () => {
    vi.stubEnv("SUPABASE_URL", "https://project.supabase.co");
    vi.stubEnv("SUPABASE_PUBLISHABLE_KEY", "publishable-test-key");
    const { from, query } = mockSupabaseRead([
      supabasePharmacyRow({
        registration: "607",
        latitude: 34.7490029,
        longitude: 32.4241615,
        provider: "geoapify",
        google: googleRow({
          registration: "607",
          classification: "exact_identity_match",
          latitude: 34.7565252,
          longitude: 32.4164677,
        }),
      }),
      supabasePharmacyRow({
        registration: "708",
        latitude: 34.7776439,
        longitude: 32.4296431,
        provider: "geoapify",
        google: googleRow({
          registration: "708",
          classification: "probable_match",
          latitude: 34.7775492,
          longitude: 32.4296866,
        }),
      }),
    ]);

    const dataset = await getPharmacyDataset(new Date("2026-09-09T10:00:00Z"));

    expect(createClientMock).toHaveBeenCalledWith(
      "https://project.supabase.co",
      "publishable-test-key",
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
    expect(from).toHaveBeenCalledWith("pharmacies");
    expect(query.eq).toHaveBeenCalledWith("is_active", true);
    expect(query.eq).not.toHaveBeenCalledWith("district", expect.anything());
    expect(query.gte).toHaveBeenCalledWith("duty_assignments.duty_date", "2026-09-08");
    expect(query.lte).toHaveBeenCalledWith("duty_assignments.duty_date", "2026-09-10");
    const publicSelect = String(query.select.mock.calls[0]?.[0]);
    expect(publicSelect).not.toContain("house_phone_e164");
    expect(publicSelect).not.toContain("house_phone_raw");
    expect(dataset.source).toBe("supabase");
    expect(dataset.pharmacies).toHaveLength(2);
    for (const pharmacy of dataset.pharmacies) {
      expect(pharmacy).not.toHaveProperty("housePhoneE164");
      expect(pharmacy).not.toHaveProperty("housePhoneRaw");
      expect(pharmacy).not.toHaveProperty("housePhoneE164Values");
    }
    expect(
      dataset.pharmacies.find(
        (pharmacy) => pharmacy.officialRegistrationNumber === "607",
      ),
    ).toMatchObject({
      latitude: 34.7565252,
      longitude: 32.4164677,
      geocodeProvider: "google_places",
    });
    expect(
      dataset.pharmacies.find(
        (pharmacy) => pharmacy.officialRegistrationNumber === "708",
      ),
    ).toMatchObject({
      latitude: 34.7776439,
      longitude: 32.4296431,
      geocodeProvider: "geoapify",
    });
  });

  it("never activates a disputed persisted fallback when Google is unavailable", async () => {
    vi.stubEnv("SUPABASE_URL", "https://project.supabase.co");
    vi.stubEnv("SUPABASE_PUBLISHABLE_KEY", "publishable-test-key");
    mockSupabaseRead([
      supabasePharmacyRow({
        registration: "607",
        latitude: 34.7490029,
        longitude: 32.4241615,
        provider: "geoapify",
        google: null,
      }),
    ]);

    const dataset = await getPharmacyDataset(new Date("2026-09-09T10:00:00Z"));

    expect(dataset.pharmacies[0]).toMatchObject({
      officialRegistrationNumber: "607",
      latitude: null,
      longitude: null,
      geocodeProvider: null,
      geocodeResultIdentifier: null,
    });
  });

  it("fails before reading a local snapshot when production configuration is absent", async () => {
    vi.stubEnv("NODE_ENV", "production");

    await expect(
      getPharmacyDataset(new Date("2026-09-09T10:00:00Z")),
    ).rejects.toThrow("Supabase runtime configuration is required in production");
    expect(createClientMock).not.toHaveBeenCalled();
  });

  it("propagates a configured production Supabase failure without snapshot fallback", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("SUPABASE_URL", "https://project.supabase.co");
    vi.stubEnv("SUPABASE_PUBLISHABLE_KEY", "publishable-test-key");
    mockSupabaseRead(null, { message: "database unavailable" });

    await expect(
      getPharmacyDataset(new Date("2026-09-09T10:00:00Z")),
    ).rejects.toThrow(
      "Unable to load pharmacy data from Supabase: database unavailable",
    );
  });
});
