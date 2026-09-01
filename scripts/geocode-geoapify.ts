import nextEnv from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import nominatimSnapshotJson from "../data/geocoding/paphos-nominatim-2026.json";
import officialSnapshot from "../data/official/cyprus-pharmacies-2026.json";
import {
  buildGeoapifySearchUrl,
  GEOAPIFY_ENDPOINT,
  GEOAPIFY_PROVIDER,
  reconcileGeoapifyResults,
  type GeoapifyResponse,
  type GeoapifyResult,
} from "../lib/geocoding/geoapify";
import { buildGeocodingQuery } from "../lib/geocoding/nominatim";
import {
  rejectDuplicateAcceptedResultIdentifiers,
  summarizeGeocodingRecords,
  type GeocodingRecord,
  type GeocodingSnapshot,
} from "../lib/geocoding/snapshot";

nextEnv.loadEnvConfig(process.cwd());

const REQUEST_INTERVAL_MILLISECONDS = 250;
const DEFAULT_OUTPUT_PATH = "data/geocoding/paphos-geoapify-2026.json";
const nominatimSnapshot = nominatimSnapshotJson as unknown as GeocodingSnapshot;

interface CliOptions {
  outputPath: string;
  refresh: boolean;
  writeSupabase: boolean;
}

function optionValue(arguments_: string[], name: string, fallback: string): string {
  const index = arguments_.indexOf(name);
  return index >= 0 ? arguments_[index + 1] ?? fallback : fallback;
}

function parseOptions(arguments_: string[]): CliOptions {
  return {
    outputPath: optionValue(arguments_, "--output", DEFAULT_OUTPUT_PATH),
    refresh: arguments_.includes("--refresh"),
    writeSupabase: arguments_.includes("--write-supabase"),
  };
}

async function existingSnapshot(
  outputPath: string,
): Promise<GeocodingSnapshot<GeoapifyResult> | null> {
  try {
    return JSON.parse(await readFile(outputPath, "utf8")) as GeocodingSnapshot<GeoapifyResult>;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

function createSnapshot(
  records: GeocodingRecord<GeoapifyResult>[],
): GeocodingSnapshot<GeoapifyResult> {
  const generatedAt = records.reduce(
    (latest, record) => (record.attemptedAt > latest ? record.attemptedAt : latest),
    officialSnapshot.metadata.generatedAt,
  );
  return {
    metadata: {
      schemaVersion: 1,
      generatedAt,
      district: "Paphos",
      sourceSnapshot: "data/official/cyprus-pharmacies-2026.json",
      sourceSnapshotGeneratedAt: officialSnapshot.metadata.generatedAt,
      provider: {
        id: GEOAPIFY_PROVIDER,
        name: "Geoapify Geocoding API",
        endpoint: GEOAPIFY_ENDPOINT,
        policyUrl: "https://www.geoapify.com/terms-and-conditions/",
        attribution: "Powered by Geoapify; source attribution retained per result",
        attributionUrl: "https://www.geoapify.com/",
        license: "Geoapify Terms and source-data licenses",
        licenseUrl: "https://www.geoapify.com/terms-and-conditions/",
        requestIntervalMilliseconds: REQUEST_INTERVAL_MILLISECONDS,
      },
    },
    report: summarizeGeocodingRecords(records),
    records,
  };
}

async function saveSnapshot(
  outputPath: string,
  records: GeocodingRecord<GeoapifyResult>[],
): Promise<GeocodingSnapshot<GeoapifyResult>> {
  const snapshot = createSnapshot(records);
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
  return snapshot;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function fetchGeoapifyResults(
  query: string,
  apiKey: string,
): Promise<GeoapifyResult[]> {
  const response = await fetch(buildGeoapifySearchUrl(query, apiKey, { language: "el" }), {
    headers: { accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error(`Geoapify request failed with HTTP ${response.status}.`);
  }
  const body = (await response.json()) as GeoapifyResponse;
  return body.results ?? [];
}

async function writeAcceptedCoordinates(
  snapshot: GeocodingSnapshot<GeoapifyResult>,
): Promise<number> {
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
        geocode_provider: GEOAPIFY_PROVIDER,
        geocode_result_identifier: record.accepted.resultIdentifier,
        geocode_query: record.query,
        geocode_quality: record.accepted.quality,
        geocoded_at: record.attemptedAt,
      })
      .eq("official_registration_number", record.officialRegistrationNumber)
      .is("latitude", null)
      .select("id");
    if (error) {
      throw new Error(
        `Unable to update pharmacy ${record.officialRegistrationNumber}: ${error.message}`,
      );
    }
    if ((data?.length ?? 0) > 1) {
      throw new Error(
        `Expected at most one database pharmacy for registration ${record.officialRegistrationNumber}, found ${data?.length ?? 0}`,
      );
    }
    updated += data?.length ?? 0;
  }
  return updated;
}

async function main() {
  const apiKey = process.env.GEOAPIFY_API_KEY;
  if (!apiKey) {
    throw new Error(
      "GEOAPIFY_API_KEY is required in the local environment or .env.local.",
    );
  }

  const options = parseOptions(process.argv.slice(2));
  const nominatimAccepted = new Set(
    nominatimSnapshot.records
      .filter((record) => record.status === "accepted")
      .map((record) => record.officialRegistrationNumber),
  );
  const selected = officialSnapshot.pharmacies.filter(
    (pharmacy) =>
      pharmacy.district === "Paphos" &&
      !nominatimAccepted.has(pharmacy.officialRegistrationNumber),
  );
  const previous = await existingSnapshot(options.outputPath);
  const cached = new Map(
    (previous?.records ?? []).map((record) => [record.officialRegistrationNumber, record]),
  );
  const records: GeocodingRecord<GeoapifyResult>[] = [];
  let lastRequestAt = 0;

  for (const [index, pharmacy] of selected.entries()) {
    const query = buildGeocodingQuery(pharmacy);
    const prior = cached.get(pharmacy.officialRegistrationNumber);
    let record: GeocodingRecord<GeoapifyResult>;

    if (!options.refresh && prior?.query === query) {
      const reconciliation = reconcileGeoapifyResults(pharmacy, prior.providerResults);
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
      let providerResults: GeoapifyResult[];
      try {
        providerResults = await fetchGeoapifyResults(query, apiKey);
      } catch (error) {
        await saveSnapshot(options.outputPath, records);
        throw error;
      } finally {
        lastRequestAt = Date.now();
      }
      const reconciliation = reconcileGeoapifyResults(pharmacy, providerResults);
      record = {
        officialRegistrationNumber: pharmacy.officialRegistrationNumber,
        query,
        attemptedAt,
        status: reconciliation.status,
        providerResults,
        reason: reconciliation.status === "accepted" ? null : reconciliation.reason,
        accepted: reconciliation.status === "accepted" ? reconciliation.accepted : null,
      };
    }

    records.push(record);
    await saveSnapshot(options.outputPath, records);
    process.stdout.write(
      `[${index + 1}/${selected.length}] ${pharmacy.officialRegistrationNumber} ${record.status}\n`,
    );
  }

  const reconciledRecords = rejectDuplicateAcceptedResultIdentifiers(records);
  const snapshot = await saveSnapshot(options.outputPath, reconciledRecords);
  const databaseRowsUpdated = options.writeSupabase
    ? await writeAcceptedCoordinates(snapshot)
    : null;
  process.stdout.write(
    `${JSON.stringify(
      {
        outputPath: options.outputPath,
        keptNominatimCoordinates: nominatimAccepted.size,
        ...snapshot.report,
        finalCoordinateCoverage: nominatimAccepted.size + snapshot.report.successfullyGeocoded,
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
