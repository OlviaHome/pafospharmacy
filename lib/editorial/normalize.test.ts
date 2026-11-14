import { describe, expect, it } from "vitest";

import { markerSlots, normalizeArticle, normalizeTranslation } from "./normalize";
import type { ArticleDraft } from "./prompts";

function draft(overrides: Partial<ArticleDraft> = {}): ArticleDraft {
  return {
    slug: "gesy",
    title: " Что такое ГеСИ ",
    description: "Описание",
    body_md: "# Заголовок\n\nТекст [[image:inline-1]] ещё текст\n\n## Раздел\n\nТекст",
    faq: [{ question: "Вопрос?", answer: "Ответ." }, { question: " ", answer: "x" }],
    sources: [
      { title: "Портал", url: "https://www.gesy.org.cy/" },
      { title: "Дубль", url: "https://www.gesy.org.cy/" },
      { title: "HTTP", url: "http://example.com" },
    ],
    images: [
      { slot: "cover", kind: "stock", search_query: "doctor", alt: "Врач", note: "" },
      { slot: "inline-1", kind: "screenshot", search_query: "ignored", alt: "Шаг", note: "экран входа" },
      { slot: "inline-9", kind: "stock", search_query: "unused", alt: "", note: "" },
    ],
    editor_notes: "",
    ...overrides,
  };
}

describe("normalizeArticle", () => {
  it("puts markers on their own line and demotes h1", () => {
    const result = normalizeArticle(draft());
    expect(result.body_md).toContain("\n\n[[image:inline-1]]\n\n");
    expect(result.body_md.startsWith("## Заголовок")).toBe(true);
  });

  it("drops unreferenced inline plans, keeps the cover, clears screenshot queries", () => {
    const result = normalizeArticle(draft());
    expect(result.images.map((image) => image.slot)).toEqual(["cover", "inline-1"]);
    expect(result.images[1].search_query).toBe("");
  });

  it("adds a placeholder plan for a marker without a plan", () => {
    const result = normalizeArticle(draft({ body_md: "Текст\n\n[[image:inline-2]]\n\nЕщё", images: [] }));
    expect(result.images.map((image) => image.slot).sort()).toEqual(["cover", "inline-2"]);
    expect(result.images.find((image) => image.slot === "inline-2")?.kind).toBe("screenshot");
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it("keeps only https, deduplicated sources and non-empty FAQ", () => {
    const result = normalizeArticle(draft());
    expect(result.sources).toEqual([{ title: "Портал", url: "https://www.gesy.org.cy/" }]);
    expect(result.faq).toHaveLength(1);
    expect(result.title).toBe("Что такое ГеСИ");
  });

  it("removes a cover marker from the body", () => {
    const result = normalizeArticle(draft({ body_md: "[[image:cover]]\n\nТекст" }));
    expect(markerSlots(result.body_md)).toEqual([]);
  });
});

describe("normalizeTranslation", () => {
  it("restores missing markers and removes unknown ones", () => {
    const result = normalizeTranslation(
      {
        title: "What is GeSY",
        description: "d",
        body_md: "Text\n\n[[image:inline-7]]\n\nMore",
        faq: [],
        sources: [],
        image_alts: [],
      },
      "Текст\n\n[[image:inline-1]]\n\nЕщё",
    );
    expect(markerSlots(result.body_md)).toEqual(["inline-1"]);
  });
});

describe("internal links", () => {
  it("keeps links to existing HealthGuide pages and removes invented ones", async () => {
    const { checkInternalLinks } = await import("./normalize");
    const result = checkInternalLinks(
      "Найдите [дежурную аптеку в Пафосе](/ru/paphos) или [на карте](https://healthguide.cy/ru/map) и [здесь](https://healthguide.cy/ru).",
    );
    expect(result.body).toBe("Найдите [дежурную аптеку в Пафосе](/ru/paphos) или на карте и [здесь](https://healthguide.cy/ru).");
    expect(result.removed).toEqual(["https://healthguide.cy/ru/map"]);
  });

  it("points translated internal links to the same page in their language", async () => {
    const { localizeInternalLinks } = await import("./normalize");
    expect(localizeInternalLinks("[Pharmacies](/ru/paphos) and [home](https://healthguide.cy/ru) [gov](https://www.gov.cy/ru/x)", "en")).toBe(
      "[Pharmacies](/en/paphos) and [home](https://healthguide.cy/en) [gov](https://www.gov.cy/ru/x)",
    );
  });

  it("no longer asks for inline images beyond the cover", async () => {
    const { normalizeArticle } = await import("./normalize");
    const result = normalizeArticle({
      slug: "x",
      title: "T",
      description: "D",
      body_md: "## Коротко\n\n- Один пункт",
      faq: [],
      sources: [{ title: "GeSY", url: "https://www.gesy.org.cy/" }],
      images: [{ slot: "cover", kind: "stock", search_query: "clinic", alt: "", note: "" }],
      editor_notes: "",
    });
    expect(result.warnings).toEqual([]);
    expect(result.claims).toEqual([]);
  });
});
