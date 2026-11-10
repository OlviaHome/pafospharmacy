import type { ReactNode } from "react";

import { FinderHeader } from "@/components/finder-header";
import type { TranslationDictionary } from "@/lib/i18n/types";

/** Shared chrome for blog pages: the site header in the site language. */
export function BlogShell({
  dictionary,
  children,
}: {
  dictionary: TranslationDictionary;
  children: ReactNode;
}) {
  return (
    <>
      <FinderHeader
        locale={dictionary.locale}
        brandName={dictionary.finder.brandName}
        blog={dictionary.finder.blog}
        about={dictionary.finder.about}
        dataSources={dictionary.finder.dataSources}
        languageLabel={dictionary.languageSelectorLabel}
      />
      <main className="min-h-[70vh] w-full bg-white pb-14">{children}</main>
    </>
  );
}
