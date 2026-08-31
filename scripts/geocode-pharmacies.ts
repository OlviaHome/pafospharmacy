import { createClient } from "@supabase/supabase-js";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import officialSnapshot from "../data/official/cyprus-pharmacies-2026.json";
import {
  buildGeocodingQuery,
  buildNominatimSearchUrl,
  NOMINATIM_ENDPOINT,
  NOMINATIM_PROVIDER,
  reconcileNominatimResults,
  type NominatimResult,
} from "../lib/geocoding/nominatim";
import {
  summarizeGeocodingRecords,
  type GeocodingRecord,
  type GeocodingSnapshot,
} from "../lib/geocoding/snapshot";

const REQUEST_INTERVAL_MILLISECONDS = 1_100;
const USER_AGENT = "PaphosPharmacy/0.1 (one-time official-address enrichment)";

interface CliOptions {
  district: string;
  outputPath: string;
  refresh: boolean;
  writeSupabase: boolean;
}

function optionValue(arguments_: string[], name: string, fallback: string): string {
  const index = arguments_.indexOf(name);
  return index >= 0 ? arguments_[index + 1] ?? fallback : fallback;
}

function parseOptions(arguments_: string[]): CliOptions {
  const district = optionValue(arguments_, "--district", "Paphos");
  return {
    district,
    outputPath: optionValue(
      arguments_,
      "--output",
      `data/geocoding/${district.toLocaleLowerCase("en")}-nominatim-2026.json`,
    ),
    refresh: arguments_.includes("--refresh"),
    writeSupabase: arguments_.includes("--write-supabase"),
  };
}

async function existingSnapshot(outputPath: string): Promise<GeocodingSnapshot | null> {
  try {
    return JSON.parse(await readFile(outputPath, "utf8")) as GeocodingSnapshot;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

function createSnapshot(
  district: string,
  records: GeocodingRecord[],
): GeocodingSnapshot {
  const generatedAt = records.reduce(
    (latest, record) => (record.attemptedAt > latest ? record.attemptedAt : latest),
    officialSnapshot.metadata.generatedAt,
  );
  return {
    metadata: {
      schemaVersion: 1,
      generatedAt,
      district,
      sourceSnapshot: "data/official/cyprus-pharmacies-2026.json",
      sourceSnapshotGeneratedAt: officialSnapshot.metadata.generatedAt,
      provider: {
        id: NOMINATIM_PROVIDER,
        name: "OpenStreetMap Nominatim",
        endpoint: NOMINATIM_ENDPOINT,
        policyUrl: "https://operations.osmfoundation.org/policies/nominatim/",
        attribution: "© OpenStreetMap contributors",
        attributionUrl: "https://www.openstreetmap.org/copyright",
        license: "Open Database License (ODbL) 1.0",
        licenseUrl: "https://opendatacommons.org/licenses/odbl/1-0/",
        requestIntervalMilliseconds: REQUEST_INTERVAL_MILLISECONDS,
      },
    },
    report: summarizeGeocodingRecords(records),
    records,
  };
}

async function saveSnapshot(
  outputPath: string,
  district: string,
  records: GeocodingRecord[],
): Promise<GeocodingSnapshot> {
  const snapshot = createSnapshot(district, records);
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
  return snapshot;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function fetchNominatimResults(query: string): Promise<NominatimResult[]> {
  const response = await fetch(buildNominatimSearchUrl(query), {
    headers: {
      accept: "application/json",
      "user-agent": USER_AGENT,
    },
  });
  if (!response.ok) {
    throw new Error(`Nominatim request failed with HTTP ${response.status}.`);
  }
  return (await response.json()) as NominatimResult[];
}

async function writeAcceptedCoordinates(snapshot: GeocodingSnapshot): Promise<number> {
  const url = process.env.SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  if (!url || !secretKey) {
    throw new Error(
      "--write-supabase requires SUPABASE_URL and SUPABASE_SECRET_KEY in the local environment",
    );
  }

  const client = createClient(url, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  let updated = 0;
  for (const record of snapshot.records) {
    if (!record.accepted || record.status !== "accepted") continue;
    const { data, error } = await client
      .from("pharmacies")
      .update({
        latitude: record.accepted.latitude,
        longitude: record.accepted.longitude,
        geocode_provider: NOMINATIM_PROVIDER,
        geocode_result_identifier: record.accepted.resultIdentifier,
        geocode_query: record.query,
        geocode_quality: record.accepted.quality,
        geocoded_at: record.attemptedAt,
      })
      .eq("official_registration_number", record.officialRegistrationNumber)
      .select("id");
    if (error) {
      throw new Error(
        `Unable to update pharmacy ${record.officialRegistrationNumber}: ${error.message}`,
      );
    }
    if (data?.length !== 1) {
      throw new Error(
        `Expected one database pharmacy for registration ${record.officialRegistrationNumber}, found ${data?.length ?? 0}`,
      );
    }
    updated += 1;
  }
  return updated;
}

async function main() {
  const options = parseOptions(process.argv.slice(2));
  const selected = officialSnapshot.pharmacies.filter(
    (pharmacy) => pharmacy.district === options.district,
  );
  if (selected.length === 0) {
    throw new Error(`No pharmacies found for district ${options.district}.`);
  }

  const previous = await existingSnapshot(options.outputPath);
  const cached = new Map(
    (previous?.records ?? []).map((record) => [record.officialRegistrationNumber, record]),
  );
  const records: GeocodingRecord[] = [];
  let lastRequestAt = 0;
  let fatalProviderError: Error | null = null;

  for (const [index, pharmacy] of selected.entries()) {
    const query = buildGeocodingQuery(pharmacy);
    const prior = cached.get(pharmacy.officialRegistrationNumber);
    let record: GeocodingRecord;

    if (pharmacy.latitude !== null && pharmacy.longitude !== null) {
      record = {
        officialRegistrationNumber: pharmacy.officialRegistrationNumber,
        query,
        attemptedAt: pharmacy.sourceRetrievedAt,
        status: "already_present",
        providerResults: [],
        reason: "The source snapshot already contained a coordinate pair.",
        accepted: null,
      };
    } else if (
      !options.refresh &&
      prior?.query === query &&
      (prior.status !== "failed" || prior.reason === "Provider returned no results.")
    ) {
      const reconciliation = reconcileNominatimResults(pharmacy, prior.providerResults);
      record = {
        officialRegistrationNumber: pharmacy.officialRegistrationNumber,
        query,
        attemptedAt: prior.attemptedAt,
        status: reconciliation.status,
        providerResults: prior.providerResults,
        reason: reconciliation.status === "accepted" ? null : reconciliation.reason,
        accepted: reconciliation.status === "accepted" ? reconciliation.accepted : null,
      };
    } else {
      const waitFor = REQUEST_INTERVAL_MILLISECONDS - (Date.now() - lastRequestAt);
      if (waitFor > 0) await delay(waitFor);
      const attemptedAt = new Date().toISOString();
      try {
        const providerResults = await fetchNominatimResults(query);
        lastRequestAt = Date.now();
        const reconciliation = reconcileNominatimResults(pharmacy, providerResults);
        record = {
          officialRegistrationNumber: pharmacy.officialRegistrationNumber,
          query,
          attemptedAt,
          status: reconciliation.status,
          providerResults,
          reason: reconciliation.status === "accepted" ? null : reconciliation.reason,
          accepted:
            reconciliation.status === "accepted" ? reconciliation.accepted : null,
        };
      } catch (error) {
        lastRequestAt = Date.now();
        fatalProviderError =
          error instanceof Error ? error : new Error(String(error));
        record = {
          officialRegistrationNumber: pharmacy.officialRegistrationNumber,
          query,
          attemptedAt,
          status: "failed",
          providerResults: [],
          reason: fatalProviderError.message,
          accepted: null,
        };
      }
    }

    records.push(record);
    await saveSnapshot(options.outputPath, options.district, records);
    process.stdout.write(
      `[${index + 1}/${selected.length}] ${pharmacy.officialRegistrationNumber} ${record.status}\n`,
    );
    if (fatalProviderError) throw fatalProviderError;
  }

  const snapshot = await saveSnapshot(options.outputPath, options.district, records);
  const databaseRowsUpdated = options.writeSupabase
    ? await writeAcceptedCoordinates(snapshot)
    : null;
  process.stdout.write(
    `${JSON.stringify(
      {
        outputPath: options.outputPath,
        ...snapshot.report,
        databaseRowsUpdated,
      },
      null,
      2,
    )}\n`,
  );
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
