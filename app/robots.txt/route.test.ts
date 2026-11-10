import { describe, expect, it } from "vitest";

import { GET } from "./route";

describe("robots.txt", () => {
  it("allows search and AI answers but not AI training", async () => {
    const text = await GET().text();
    expect(text).toContain("Content-Signal: ai-train=no, search=yes, ai-input=yes");
    expect(text).not.toContain("ai-train=yes");
    expect(text).toContain("Disallow: /api/");
    expect(text).toContain("Sitemap: https://healthguide.cy/sitemap.xml");
  });
});
