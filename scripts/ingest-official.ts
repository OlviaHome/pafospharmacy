import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  normalizeOfficialResources,
  type ResourceText,
} from "../lib/ingestion/normalize";
import {
  OFFICIAL_DATASET_PAGE,
  OFFICIAL_LICENSE,
  OFFICIAL_LICENSE_URL,
  OFFICIAL_ORGANIZATION,
  OFFICIAL_RESOURCES,
} from "../lib/ingestion/official-sources";
import { writeOfficialImportToSupabase } from "../lib/ingestion/supabase-writer";

interface CliOptions {
  inputDirectory: string | null;
  outputPath: string;
  writeSupabase: boolean;
}

function parseOptions(arguments_: string[]): CliOptions {
  const inputIndex = arguments_.indexOf("--input-dir");
  const outputIndex = arguments_.indexOf("--output");
  return {
    inputDirectory: inputIndex >= 0 ? arguments_[inputIndex + 1] ?? null : null,
    outputPath:
      outputIndex >= 0
        ? (arguments_[outputIndex + 1] ?? "data/official/cyprus-pharmacies-2026.json")
        : "data/official/cyprus-pharmacies-2026.json",
    writeSupabase: arguments_.includes("--write-supabase"),
  };
}

async function loadResource(
  resource: (typeof OFFICIAL_RESOURCES)[number],
  inputDirectory: string | null,
): Promise<ResourceText> {
  if (inputDirectory) {
    return {
      resource,
      text: await readFile(path.join(inputDirectory, resource.filename), "utf8"),
    };
  }

  const response = await fetch(resource.url, {
    headers: { "user-agent": "Paphos Pharmacy official data importer" },
  });
  if (!response.ok) {
    throw new Error(`Download failed for ${resource.id}: HTTP ${response.status}`);
  }
  return { resource, text: await response.text() };
}

async function main() {
  const options = parseOptions(process.argv.slice(2));
  const retrievedAt = new Date().toISOString();
  const resources = await Promise.all(
    OFFICIAL_RESOURCES.map((resource) => loadResource(resource, options.inputDirectory)),
  );
  const normalized = normalizeOfficialResources(resources, retrievedAt);
  const snapshot = {
    metadata: {
      generatedAt: retrievedAt,
      organization: OFFICIAL_ORGANIZATION,
      datasetPage: OFFICIAL_DATASET_PAGE,
      license: OFFICIAL_LICENSE,
      licenseUrl: OFFICIAL_LICENSE_URL,
      dutyCoverageStart: "2026-05-01",
      dutyCoverageEnd: "2026-09-30",
      resources: OFFICIAL_RESOURCES,
      report: normalized.report,
    },
    pharmacies: normalized.pharmacies,
    dutyAssignments: normalized.dutyAssignments,
  };

  await mkdir(path.dirname(options.outputPath), { recursive: true });
  await writeFile(options.outputPath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");

  let database = null;
  if (options.writeSupabase) {
    const url = process.env.SUPABASE_URL;
    const secretKey = process.env.SUPABASE_SECRET_KEY;
    if (!url || !secretKey) {
      throw new Error(
        "--write-supabase requires SUPABASE_URL and SUPABASE_SECRET_KEY in the local environment",
      );
    }
    database = await writeOfficialImportToSupabase(normalized, url, secretKey);
  }

  process.stdout.write(
    `${JSON.stringify(
      {
        outputPath: options.outputPath,
        ...normalized.report,
        database,
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
