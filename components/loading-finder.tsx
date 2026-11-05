import { FinderHeader } from "@/components/finder-header";
import type { TranslationDictionary } from "@/lib/i18n/types";

export function LoadingFinder({ dictionary }: { dictionary: TranslationDictionary }) {
  return (
    <main className="min-h-screen bg-[var(--background)]">
      <FinderHeader
        locale={dictionary.locale}
        brandName={dictionary.finder.brandName}
        about={dictionary.finder.about}
        dataSources={dictionary.finder.dataSources}
        languageLabel={dictionary.languageSelectorLabel}
      />
      <section className="bg-[linear-gradient(120deg,var(--hero-dark),var(--brand-strong))] text-white">
        <div className="mx-auto flex w-full max-w-7xl flex-col justify-center px-4 py-12 sm:px-6 sm:py-16 lg:min-h-[22rem] lg:px-8 lg:py-16">
          <h1 className="max-w-5xl text-balance text-[clamp(2.5rem,5vw,4rem)] font-medium leading-[0.98] tracking-[-0.035em]">
            {dictionary.finder.heroTitle}
          </h1>
          <h2 className="mt-4 max-w-6xl text-balance text-[clamp(1.125rem,2vw,1.5rem)] font-normal leading-[1.2] text-white/65 lg:whitespace-nowrap">
            {dictionary.finder.heroSchedulePeriod}
          </h2>
        </div>
      </section>
      <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        <div className="h-44 animate-pulse rounded-2xl bg-white shadow-[var(--shadow)]" />
        <p className="mt-5 text-sm font-semibold text-[var(--ink-muted)]">
          {dictionary.finder.loading}
        </p>
      </div>
    </main>
  );
}
