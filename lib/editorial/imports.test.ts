import { describe, expect, it } from "vitest";

import { detectLanguage, importChecks, originalityCheck, type ImportInfo } from "./imports";
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

describe("language of an imported material", () => {
  it("tells Russian, Ukrainian, Greek and English apart", () => {
    expect(detectLanguage("Министерство здравоохранения объявило о новой схеме работы скорой помощи.").code).toBe("ru");
    expect(detectLanguage("Міністерство охорони здоров’я оголосило про нову схему роботи швидкої допомоги, їй потрібні кошти.").code).toBe("uk");
    expect(detectLanguage("Το υπουργείο υγείας ανακοίνωσε νέο σχέδιο για το ασθενοφόρο.").code).toBe("el");
    expect(detectLanguage("The Health Ministry announced a new ambulance service plan.").code).toBe("en");
  });

  it("keeps a Russian text with a Ukrainian name or quote Russian", () => {
    expect(detectLanguage("Врач Олена Шевченко из Києва рассказала о новой схеме работы скорой помощи и о том, как вызвать бригаду.").code).toBe("ru");
  });

  it("makes the independence check need a translation for a Ukrainian material", () => {
    const result = originalityCheck(post({ language: "uk", sourceTextRu: null }));
    expect(result).toMatchObject({ ok: false, blocking: true });
  });
});
