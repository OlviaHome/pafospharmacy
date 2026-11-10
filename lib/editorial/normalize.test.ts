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
