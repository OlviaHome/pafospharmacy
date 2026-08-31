import { connection } from "next/server";
import { Suspense } from "react";

import { PharmacyFinder } from "@/components/pharmacy-finder";
import { getPharmacyDataset } from "@/lib/data/pharmacies";

async function PharmacyFinderData() {
  await connection();
  const dataset = await getPharmacyDataset(new Date());
  return <PharmacyFinder {...dataset} />;
}

function LoadingFinder() {
  return (
    <main className="mx-auto min-h-screen w-full max-w-3xl px-4 py-5 sm:px-6 sm:py-8">
      <header className="mb-5">
        <h1 className="text-xl font-extrabold text-[var(--ink)]">Paphos Pharmacy</h1>
        <p className="mt-1 text-sm text-[var(--ink-muted)]">Find a pharmacy you can use now.</p>
      </header>
      <div className="h-44 animate-pulse rounded-3xl border border-[var(--line)] bg-[var(--surface)]" />
      <p className="mt-5 text-sm font-semibold text-[var(--ink-muted)]">Loading pharmacy information…</p>
    </main>
  );
}

export default function Home() {
  return (
    <Suspense fallback={<LoadingFinder />}>
      <PharmacyFinderData />
    </Suspense>
  );
}
