import { describe, expect, it } from "vitest";

import { importChecks, languageLabel, originalityCheck, otherLanguage, type ImportInfo } from "./imports";
import type { EditorialPost } from "./store";

function post(info: Partial<ImportInfo> | null): EditorialPost {
  return {
    id: "p",
    number: 1,
    slug: "s",
    topic: "t",
    status: "review",
    previewToken: "",
    lastError: null,
    editorNotes: null,
    sourceChecks: [],
    factChecks: [],
    viewCount: 0,
    publishedAt: null,
    createdAt: "",
    updatedAt: "",
    translations: [
      { locale: "ru", status: "review", title: "Т", description: "", bodyMd: "## Коротко\n\nСвой текст статьи.", faq: [], sources: [], publishedAt: null, updatedAt: "" },
    ],
    images: [],
    importInfo: info
      ? { id: "i", mode: "rewrite", language: "en", sourceUrl: null, sourceLabel: null, sourceText: "Material.", sourceTextRu: null, ...info }
      : null,
  };
}

describe("independence check of an imported draft", () => {
  it("is not added to ordinary drafts", () => {
    expect(importChecks(post(null))).toBeUndefined();
  });

  it("blocks instead of passing when a non-Russian material has no working translation", () => {
    const check = originalityCheck(post({ language: "en", sourceTextRu: null }));
    expect(check).toMatchObject({ ok: false, blocking: true });
    expect(check!.label).toContain("Проверка самостоятельности не выполнена");
  });

  it("blocks when the material itself is missing", () => {
    expect(originalityCheck(post({ sourceText: null, language: "ru" }))).toMatchObject({ ok: false, blocking: true });
  });

  it("runs on a Russian material without a translation", () => {
    expect(originalityCheck(post({ language: "ru", sourceText: "Другой текст материала." }))).toMatchObject({ ok: true });
  });

  it("runs on a non-Russian material with its translation", () => {
    expect(originalityCheck(post({ language: "en", sourceTextRu: "Перевод материала." }))).toMatchObject({ ok: true });
  });
});

describe("language of an imported material (chosen by the editor, never guessed)", () => {
  it("shows the four buttons' languages and a typed one by name", () => {
    expect(languageLabel("ru")).toBe("Русский");
    expect(languageLabel("uk")).toBe("Українська");
    expect(languageLabel("other:Польский")).toBe("Польский");
    expect(languageLabel(null)).toBe("не указан");
  });

  it("cleans a typed language name and refuses an empty or very long one", () => {
    expect(otherLanguage("  польский ")).toBe("other:польский");
    expect(otherLanguage("<b>иврит</b>")).toBe("other:b иврит /b");
    expect(otherLanguage(" ")).toBeNull();
    expect(otherLanguage("x".repeat(41))).toBeNull();
  });

  it("makes the independence check need a translation for any language but Russian", () => {
    for (const language of ["en", "uk", "other:Польский"]) {
      expect(originalityCheck(post({ language, sourceTextRu: null }))).toMatchObject({ ok: false, blocking: true });
    }
  });
});
