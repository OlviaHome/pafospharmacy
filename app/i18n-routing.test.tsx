import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import LocaleLayout, { generateStaticParams } from "@/app/[locale]/layout";
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
});
