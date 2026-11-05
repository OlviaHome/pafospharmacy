import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("server-only", () => ({}));
vi.mock("next/font/google", () => ({
  Instrument_Sans: vi.fn(() => ({
    className: "instrument-sans",
    style: { fontFamily: "Instrument Sans" },
    variable: "instrument-sans-variable",
  })),
}));
vi.mock("next/navigation", () => ({
  notFound: vi.fn(),
  usePathname: () => "/en",
  useRouter: () => ({ push: vi.fn() }),
}));

import LocaleLayout, { generateStaticParams } from "@/app/[locale]/layout";
import { LoadingFinder } from "@/components/loading-finder";
import { en } from "@/lib/i18n/locales/en";
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

  it("keeps the complete live header contract while finder data is loading", () => {
    const markup = renderToStaticMarkup(<LoadingFinder dictionary={en} />);

    expect(markup).toContain("Cyprus Pharmacy");
    expect(markup).toContain('href="/en/about"');
    expect(markup).toContain('href="/en/data-sources"');
    expect(markup).toContain('aria-label="Language"');
    expect(markup).toContain("Official duty schedule across Cyprus · 1 Oct 2026 — 30 Apr 2027");
    expect(markup).toContain("Loading pharmacy information…");
    expect(markup).not.toContain("pharmacies ·");
  });
});
