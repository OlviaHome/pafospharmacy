import { describe, expect, it } from "vitest";

import { localeDirection, localizePath, preferredLocale } from "./config";
import { ar } from "./locales/ar";
import { el } from "./locales/el";
import { en } from "./locales/en";
import { ru } from "./locales/ru";

describe("locale configuration", () => {
  it("matches weighted language preferences by supported base language", () => {
    expect(preferredLocale(undefined, "fr-FR;q=0.9,ru-RU;q=0.8,en;q=0.7")).toBe("ru");
    expect(preferredLocale(undefined, "ar-LB,el;q=0.9")).toBe("ar");
  });

  it("prefers a valid explicit choice and otherwise falls back to English", () => {
    expect(preferredLocale("el", "ar-LB,ar;q=0.9")).toBe("el");
    expect(preferredLocale("de", "de-DE,de;q=0.9")).toBe("en");
    expect(preferredLocale(undefined, null)).toBe("en");
  });

  it("uses RTL only for Arabic", () => {
    expect(localeDirection("ar")).toBe("rtl");
    expect(localeDirection("en")).toBe("ltr");
    expect(localeDirection("el")).toBe("ltr");
    expect(localeDirection("ru")).toBe("ltr");
  });

  it("preserves an equivalent page when replacing the locale", () => {
    expect(localizePath("/en/data-sources", "ar")).toBe("/ar/data-sources");
    expect(localizePath("/privacy", "el")).toBe("/el/privacy");
  });

  it.each([en, el, ru, ar])(
    "keeps complete finder parity for $locale",
    (dictionary) => {
      const values = Object.values(dictionary.finder);
      expect(values.every((value) => typeof value === "string" && value.length > 0)).toBe(
        true,
      );
      expect(dictionary.finder.brandName).toBe("Cyprus Pharmacy");
      expect(dictionary.finder.distanceMethod.length).toBeGreaterThan(0);
      expect(dictionary.finder.onCallBadge.length).toBeGreaterThan(0);
    },
  );
});
