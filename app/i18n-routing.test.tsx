import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/font/google", () => ({
  Instrument_Sans: vi.fn(() => ({
    className: "instrument-sans",
    style: { fontFamily: "Instrument Sans" },
    variable: "instrument-sans-variable",
  })),
}));
vi.mock("next/server", () => ({ connection: vi.fn(async () => undefined) }));
vi.mock("@/lib/data/pharmacies", () => ({
  getPharmacyDataset: vi.fn(async () => ({ pharmacies: [], source: "fixtures" })),
}));
vi.mock("next/navigation", () => ({
  notFound: vi.fn(),
  usePathname: () => "/en",
  useRouter: () => ({ push: vi.fn() }),
}));

import LocaleLayout, { generateStaticParams } from "@/app/[locale]/layout";
import Home from "@/app/[locale]/page";
import { PharmacyFinder } from "@/components/pharmacy-finder";
import { localizePath } from "@/lib/i18n/config";
import { localizedAlternates } from "@/lib/i18n/metadata";

describe("localized route documents and metadata", () => {
  it("prebuilds every supported locale route", () => {
    expect(generateStaticParams()).toEqual([
      { locale: "en" },
      { locale: "el" },
      { locale: "ru" },
      { locale: "ar" },
    ]);
  });

  it("sets the Arabic document language and direction", async () => {
    const document = await LocaleLayout({
      children: <main>content</main>,
      params: Promise.resolve({ locale: "ar" }),
    });

    expect(document.type).toBe("html");
    expect(document.props.lang).toBe("ar");
    expect(document.props.dir).toBe("rtl");
  });

  it("publishes a clean locale canonical, all hreflang alternates, and x-default", () => {
    expect(localizedAlternates("ru", "/privacy")).toEqual({
      canonical: "/ru/privacy",
      languages: {
        en: "/en/privacy",
        el: "/el/privacy",
        ru: "/ru/privacy",
        ar: "/ar/privacy",
        "x-default": "/",
      },
    });
  });

  it("renders the home finder without a loading placeholder so language switches stay coherent", async () => {
    for (const locale of ["en", "el", "ru", "ar"] as const) {
      const page = await Home({ params: Promise.resolve({ locale }) });

      // A Suspense wrapper here would flash a blank placeholder on every language switch.
      expect(page.type).toBe(PharmacyFinder);
      expect(page.props.locale).toBe(locale);
      expect(page.props.fallback).toBeUndefined();
    }
  });

  it("keeps the same page when only the language changes", () => {
    expect(localizePath("/en", "ru")).toBe("/ru");
    expect(localizePath("/en/limassol", "ar")).toBe("/ar/limassol");
    expect(localizePath("/ar/paphos", "el")).toBe("/el/paphos");
  });
});
