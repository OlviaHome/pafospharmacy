import { describe, expect, it, vi } from "vitest";

import { OFFICIAL_DATA_RETRIEVED_AT } from "@/lib/data/official-data-date";
import { DISTRICT_SLUGS } from "@/lib/i18n/district-pages";

vi.mock("@/lib/blog/repository", () => ({ getPublishedPosts: async () => [] }));

import sitemap from "./sitemap";

describe("sitemap lastModified", () => {
  it("uses the real official-data retrieval date only for the home and district pages", async () => {
    const entries = await sitemap();
    const withDate = entries.filter((entry) => entry.lastModified);
    const expectedPaths = ["", ...DISTRICT_SLUGS.map((slug) => `/${slug}`)];

    expect(OFFICIAL_DATA_RETRIEVED_AT).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(withDate).toHaveLength(expectedPaths.length * 4);
    for (const entry of withDate) {
      expect(entry.lastModified).toBe(OFFICIAL_DATA_RETRIEVED_AT);
      const path = new URL(entry.url).pathname.replace(/^\/(en|el|ru|ar)/, "");
      expect(expectedPaths).toContain(path);
    }
    for (const path of ["/hospitals", "/blog", "/about", "/data-sources", "/privacy", "/terms"]) {
      const entry = entries.find((item) => new URL(item.url).pathname === `/en${path}`);
      expect(entry?.lastModified).toBeUndefined();
    }
  });
});
