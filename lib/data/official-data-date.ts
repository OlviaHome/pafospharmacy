import officialSnapshot from "@/data/official/cyprus-pharmacies-2026.json";

/**
 * When the official pharmacy data was last actually retrieved from the
 * publisher (the `ingest:official` run). The same run writes the Supabase rows,
 * so this equals the newest `source_retrieved_at` in the database. It is a
 * stable build-time value: unlike `PharmacyDataset.generatedAt` it does not
 * change on every request, so it is safe to publish as sitemap `lastModified`.
 */
export const OFFICIAL_DATA_RETRIEVED_AT: string = officialSnapshot.metadata.generatedAt;
