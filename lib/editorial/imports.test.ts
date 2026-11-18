import { describe, expect, it } from "vitest";

import { authorTextOf, importChecks, languageLabel, originalityCheck, otherLanguage, preservationCheck, translationChecks, type ImportInfo } from "./imports";
import { textHash, type Suggestion } from "./prepare";
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
    suggestions: [],
    importInfo: info
      ? { id: "i", mode: "rewrite", language: "en", sourceUrl: null, sourceLabel: null, sourceText: "Material.", sourceTextRu: null, prepared: null, acceptedHash: null, ...info }
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

describe("mode B: the author's text is kept", () => {
  const SOURCE = "Скорая помощь на Кипре работает круглосуточно. Вызов бесплатный.\n\nЕсли вы приехали недавно, сохраните номер заранее.";
  const BODY = `## Коротко\n\n- Вызов бесплатный.\n\n## Что делать новичку?\n\n${SOURCE}`;

  function modeB(body: string, info: Partial<ImportInfo> = {}, suggestions: Suggestion[] = []): EditorialPost {
    const base = post({ mode: "prepare", language: "ru", sourceText: SOURCE, ...info });
    return { ...base, suggestions, translations: [{ ...base.translations[0], bodyMd: body }] };
  }

  it("passes when only structure was added around the author's paragraphs", () => {
    expect(preservationCheck(modeB(BODY))).toMatchObject({ ok: true, blocking: true });
  });

  it("passes typography and one spelling fix in a Russian text, but not a changed word or number", () => {
    expect(preservationCheck(modeB(BODY.replace("круглосуточно.", "круглосуточно").replace("Вызов бесплатный", "Вызов  «бесплатный»")))?.ok).toBe(true);
    const changedWord = preservationCheck(modeB(BODY.replace("круглосуточно. Вызов бесплатный.", "круглосуточно. Вызов платный.")));
    expect(changedWord).toMatchObject({ ok: false, blocking: true });
    expect(changedWord?.label).toContain("бесплатный");
    expect(preservationCheck(modeB(BODY.replace("Если вы приехали недавно", "Если вы приехали недавно, 112")))?.ok).toBe(false);
  });

  it("an accepted suggestion explains its change, a pending one does not", () => {
    const suggestion: Suggestion = { id: "s1", before: "сохраните номер заранее", after: "заранее запишите номер", reason: "", status: "pending" };
    const body = BODY.replace("сохраните номер заранее", "заранее запишите номер");
    expect(preservationCheck(modeB(body, {}, [suggestion]))?.ok).toBe(false);
    expect(preservationCheck(modeB(body, {}, [{ ...suggestion, status: "accepted" }]))?.ok).toBe(true);
  });

  it("the editor's confirmation holds only for the text it was given for", () => {
    const edited = BODY.replace("круглосуточно", "днём");
    const post1 = modeB(edited);
    expect(preservationCheck(post1)?.ok).toBe(false);
    const hash = textHash(authorTextOf(post1)!);
    expect(preservationCheck(modeB(edited, { acceptedHash: hash }))).toMatchObject({ ok: true });
    expect(preservationCheck(modeB(edited.replace("днём", "ночью"), { acceptedHash: hash }))?.ok).toBe(false);
  });

  it("blocks when there is nothing to compare with, and is off for mode A and ordinary drafts", () => {
    expect(preservationCheck(modeB(BODY, { sourceText: null }))).toMatchObject({ ok: false, blocking: true });
    expect(preservationCheck(post({ mode: "rewrite" }))).toBeNull();
    expect(preservationCheck(post(null))).toBeNull();
  });

  it("a foreign text is compared with the stored translation, strictly, and skips the originality check", () => {
    const translation = "Звонки на 112 бесплатны.\n\nСкорая приезжает за 18 минут.";
    const prepared = { pairs: [{ o: "Calls to 112 are free.", t: "Звонки на 112 бесплатны." }, { o: "The ambulance arrives in 18 minutes.", t: "Скорая приезжает за 18 минут." }], text: translation };
    const foreign = (body: string) => modeB(body, { language: "en", sourceText: "Calls to 112 are free.\n\nThe ambulance arrives in 18 minutes.", prepared });
    const ok = foreign(`## Коротко\n\n- Бесплатно.\n\n${translation}`);
    expect(preservationCheck(ok)?.ok).toBe(true);
    // A one-letter change would pass for a Russian text; for a translation it must not.
    expect(preservationCheck(foreign(`## Коротко\n\n- Бесплатно.\n\n${translation.replace("приезжает", "приезжаит")}`))?.ok).toBe(false);
    const checks = importChecks(ok)!;
    expect(checks.extra.map((check) => check.id)).toEqual(["preservation", "translation"]);
    expect(checks.extra.every((check) => check.ok)).toBe(true);
    expect(checks.extra.some((check) => check.id === "originality")).toBe(false);
  });

  it("blocks a translation that changed a number, and only asks to confirm a missing Latin name", () => {
    const wrong = modeB(BODY, {
      language: "en",
      prepared: { pairs: [{ o: "The ambulance arrives in 18 minutes.", t: "Скорая приезжает за 15 минут." }], text: "Скорая приезжает за 15 минут." },
    });
    expect(translationChecks(wrong)[0]).toMatchObject({ id: "translation", ok: false, blocking: true });
    const names = modeB(BODY, {
      language: "en",
      prepared: { pairs: [{ o: "GeSY covers a personal doctor.", t: "Система покрывает личного врача." }], text: "Система покрывает личного врача." },
    });
    const results = translationChecks(names);
    expect(results.find((check) => check.id === "translation")?.ok).toBe(true);
    expect(results.find((check) => check.id === "translation-names")).toMatchObject({ ok: false });
    expect(results.find((check) => check.id === "translation-names")?.blocking).toBeFalsy();
  });

  it("a foreign text without a stored translation blocks", () => {
    expect(translationChecks(modeB(BODY, { language: "en", prepared: null }))[0]).toMatchObject({ ok: false, blocking: true });
    expect(translationChecks(modeB(BODY))).toEqual([]);
  });
});
