import { describe, expect, it } from "vitest";

import { chooseTranslation, fillTemplate, readingMinutes, splitBody, translationLocales } from "./content";
import type { BlogPost, BlogTranslation } from "./types";

function translation(locale: BlogTranslation["locale"], bodyMd = "text"): BlogTranslation {
  return {
    locale,
    status: "published",
    title: `title ${locale}`,
    description: "",
    bodyMd,
    faq: [],
    sources: [],
    publishedAt: "2026-11-10T09:00:00Z",
    updatedAt: "2026-11-10T09:00:00Z",
  };
}

function post(locales: BlogTranslation["locale"][]): BlogPost {
  return {
    id: "p",
    slug: "p",
    status: "published",
    authorName: "HealthGuide Cyprus",
    publishedAt: "2026-11-10T09:00:00Z",
    updatedAt: "2026-11-10T09:00:00Z",
    viewCount: 0,
    translations: locales.map((locale) => translation(locale)),
    images: [],
  };
}

describe("splitBody", () => {
  it("splits Markdown at standalone image markers", () => {
    expect(splitBody("Intro\n\n[[image:inline-1]]\n\n## Next\n\nMore\n[[image:step-2]]")).toEqual([
      { type: "markdown", text: "Intro" },
      { type: "image", slot: "inline-1" },
      { type: "markdown", text: "## Next\n\nMore" },
      { type: "image", slot: "step-2" },
    ]);
  });

  it("leaves inline mentions of markers as text", () => {
    expect(splitBody("See [[image:inline-1]] here")).toEqual([
      { type: "markdown", text: "See [[image:inline-1]] here" },
    ]);
  });
});

describe("chooseTranslation", () => {
  it("opens the article in the site language", () => {
    const chosen = chooseTranslation(post(["en", "ru"]), "ru");
    expect(chosen?.translation.locale).toBe("ru");
    expect(chosen?.isFallback).toBe(false);
  });

  it("shows another article language on explicit request without changing the site", () => {
    const chosen = chooseTranslation(post(["en", "ru"]), "ru", "en");
    expect(chosen?.translation.locale).toBe("en");
    expect(chosen?.isExplicitChoice).toBe(true);
  });

  it("ignores unknown or unavailable requested languages", () => {
    expect(chooseTranslation(post(["en", "ru"]), "ru", "xx")?.translation.locale).toBe("ru");
    expect(chooseTranslation(post(["en", "ru"]), "ru", "ar")?.translation.locale).toBe("ru");
  });

  it("falls back to English, then Russian, when the site language is missing", () => {
    expect(chooseTranslation(post(["ru", "en"]), "ar")).toMatchObject({
      translation: { locale: "en" },
      isFallback: true,
    });
    expect(chooseTranslation(post(["ru"]), "el")?.translation.locale).toBe("ru");
  });

  it("returns null for a post without translations", () => {
    expect(chooseTranslation(post([]), "en")).toBeNull();
  });
});

describe("helpers", () => {
  it("lists translation locales in site order", () => {
    expect(translationLocales(post(["ar", "ru", "en"]))).toEqual(["en", "ru", "ar"]);
  });

  it("estimates reading time and never returns zero", () => {
    expect(readingMinutes(translation("en", "word ".repeat(1000)))).toBe(5);
    expect(readingMinutes(translation("en", ""))).toBe(1);
  });

  it("fills templates and keeps unknown placeholders", () => {
    expect(fillTemplate("{count} min · {other}", { count: 4 })).toBe("4 min · {other}");
  });
});

describe("pluralize", () => {
  it("uses each language's plural rules and digits", async () => {
    const { pluralize } = await import("./content");
    const ru = { one: "{count} просмотр", few: "{count} просмотра", many: "{count} просмотров", other: "{count} просмотра" };
    expect([1, 3, 5, 21].map((n) => pluralize(ru, n, "ru"))).toEqual([
      "1 просмотр",
      "3 просмотра",
      "5 просмотров",
      "21 просмотр",
    ]);
    const ar = { one: "مشاهدة واحدة", two: "مشاهدتان", few: "{count} مشاهدات", other: "{count} مشاهدة" };
    expect(pluralize(ar, 1, "ar")).toBe("مشاهدة واحدة");
    expect(pluralize(ar, 2, "ar")).toBe("مشاهدتان");
    expect(pluralize({ other: "{count} views" }, 1200, "en")).toBe("1,200 views");
  });
});
