import { describe, expect, it } from "vitest";

import {
  applySuggestion,
  assembleBody,
  checkParagraph,
  diffTokens,
  explainedByAccepted,
  formatPairs,
  mainTextOf,
  pairsProblems,
  splitParagraphs,
  textHash,
  tokens,
  type Suggestion,
} from "./prepare";

// Invented text, not a statement about Cyprus.
const SOURCE = `Скорая помощь на Кипре работает круглосуточно. Вызов бесплатный: звоните 112 или 1400.

Если вы приехали недавно, сохраните номер заранее. Бригада приезжает в среднем за 18 минут, в сельских районах - дольше.

Дежурная аптека обычно работает до 22:00, а в выходные - по особому графику.`;

describe("word comparison with the original", () => {
  it("accepts typography only: quotes, dashes, spacing, case, formatting", () => {
    const typographic = SOURCE.replace(/ - /g, " — ").replace("Вызов", "**Вызов**").replace(/ {1}/g, "  ");
    expect(checkParagraph(SOURCE, typographic)).toMatchObject({ ok: true, hunks: [] });
  });

  it("accepts one spelling fix inside a long word and a merged or split word", () => {
    expect(checkParagraph("Скорая помощь приежает быстро и по этому мы рады.", "Скорая помощь приезжает быстро и поэтому мы рады.").ok).toBe(true);
  });

  it("rejects a changed word, an added word and a removed word", () => {
    expect(checkParagraph("Вызов бесплатный для всех жителей.", "Вызов платный для всех жителей.").ok).toBe(false);
    expect(checkParagraph("Вызов бесплатный для всех жителей.", "Вызов бесплатный для всех жителей острова.").ok).toBe(false);
    const removed = checkParagraph("Вызов бесплатный для всех жителей острова.", "Вызов бесплатный для всех жителей.");
    expect(removed.hunks[0]).toMatchObject({ before: "острова", after: "" });
  });

  it("never lets a number, a date, a phone or a link change", () => {
    for (const changed of [
      SOURCE.replace("112", "113"),
      SOURCE.replace("22:00", "21:00"),
      SOURCE.replace("18 минут", "15 минут"),
      "Подробности: https://www.gesy.org.cy/a и тел. +357 25 123456.".replace("gesy.org.cy/a", "gesy.org.cy/b"),
    ]) {
      const original = changed === SOURCE.replace("112", "113") || changed.startsWith("Скорая") ? SOURCE : "Подробности: https://www.gesy.org.cy/a и тел. +357 25 123456.";
      expect(checkParagraph(original, changed).ok).toBe(false);
    }
  });

  it("shows where the texts differ", () => {
    const changed = SOURCE.replace("круглосуточно", "в любое время");
    const [hunk] = diffTokens(tokens(SOURCE), tokens(changed), true);
    expect(hunk.before).toBe("круглосуточно");
    expect(hunk.after).toBe("в любое время");
  });
});

describe("the article built around the author's paragraphs", () => {
  const paragraphs = splitParagraphs(SOURCE);

  it("splits at blank lines", () => {
    expect(paragraphs).toHaveLength(3);
  });

  it("puts «Коротко», added headings and image markers around untouched paragraphs", () => {
    const body = assembleBody({
      paragraphs,
      headings: [{ before: 1, text: "## Что делать новичку?" }],
      short_points: ["Вызов бесплатный.", "Номера 112 и 1400."],
      inline_images: [{ slot: "inline-1", after: 1 }],
    });
    expect(body.startsWith("## Коротко\n\n- Вызов бесплатный.\n- Номера 112 и 1400.")).toBe(true);
    expect(body).toContain("## Что делать новичку?\n\nЕсли вы приехали недавно");
    expect(body).toContain("в сельских районах - дольше.\n\n[[image:inline-1]]");
  });

  it("finds the author's own text again, without the added blocks", () => {
    const body = assembleBody({
      paragraphs,
      headings: [{ before: 1, text: "Что делать новичку?" }],
      short_points: ["Вызов бесплатный."],
      inline_images: [{ slot: "inline-1", after: 0 }],
    });
    const main = mainTextOf(body, SOURCE);
    expect(diffTokens(tokens(SOURCE), tokens(main), false)).toEqual([]);
    expect(main).not.toContain("Коротко");
    expect(main).not.toContain("Что делать новичку");
  });

  it("keeps a heading that is the author's own line", () => {
    const own = "Как вызвать скорую\n\nЗвоните 112.";
    const body = assembleBody({ paragraphs: splitParagraphs(own), headings: [], short_points: ["Звоните 112."], inline_images: [] }).replace("Как вызвать скорую", "## Как вызвать скорую");
    expect(diffTokens(tokens(own), tokens(mainTextOf(body, own)), false)).toEqual([]);
  });

  it("a word changed afterwards shows up and changes the hash", () => {
    const body = assembleBody({ paragraphs, headings: [], short_points: ["Вызов бесплатный."], inline_images: [] });
    const edited = body.replace("круглосуточно", "днём");
    const hunks = diffTokens(tokens(SOURCE), tokens(mainTextOf(edited, SOURCE)), true);
    expect(hunks).toHaveLength(1);
    expect(textHash(mainTextOf(edited, SOURCE))).not.toBe(textHash(mainTextOf(body, SOURCE)));
    expect(textHash(mainTextOf(body, SOURCE))).toBe(textHash(SOURCE));
  });
});

describe("suggestions", () => {
  const suggestion: Suggestion = { id: "s1", before: "в среднем за 18 минут", after: "примерно за 18 минут", reason: "точнее", status: "pending" };

  it("replaces the fragment exactly once, or says it cannot", () => {
    expect(applySuggestion(SOURCE, suggestion)).toContain("Бригада приезжает примерно за 18 минут,");
    expect(applySuggestion(SOURCE, { before: "нет такого", after: "x" })).toBeNull();
    expect(applySuggestion("а а", { before: "а", after: "б" })).toBeNull();
  });

  it("an accepted suggestion explains its difference from the original, a pending one does not", () => {
    const changed = SOURCE.replace("в среднем за 18 минут", "примерно за 18 минут");
    const hunks = diffTokens(tokens(SOURCE), tokens(changed), true);
    expect(hunks.length).toBeGreaterThan(0);
    expect(hunks.every((hunk) => explainedByAccepted(hunk, [{ ...suggestion, status: "accepted" }]))).toBe(true);
    expect(hunks.some((hunk) => explainedByAccepted(hunk, [suggestion]))).toBe(false);
  });
});

describe("a translation paragraph by paragraph", () => {
  const pairs = [
    { o: "Calls to 112 are free. The ambulance arrives in 18 minutes on average.", t: "Звонки на 112 бесплатны. Скорая приезжает в среднем за 18 минут." },
    { o: "GeSY covers visits to a personal doctor from 1 June 2019. See https://www.gesy.org.cy/en.", t: "ГеСИ покрывает визиты к личному врачу с 1 июня 2019 года. Подробнее: https://www.gesy.org.cy/en." },
  ];

  it("passes a faithful translation", () => {
    expect(pairsProblems(pairs).filter((problem) => problem.blocking)).toEqual([]);
  });

  it("blocks a missing paragraph, a changed number, a changed link and a suspicious length", () => {
    expect(pairsProblems([{ ...pairs[0], t: "" }])[0]).toMatchObject({ blocking: true, index: 0 });
    expect(pairsProblems([{ ...pairs[0], t: pairs[0].t.replace("18", "15") }])[0].text).toContain("числа");
    expect(pairsProblems([pairs[0], { ...pairs[1], t: pairs[1].t.replace("/en", "/ru") }])[0]).toMatchObject({ blocking: true, index: 1 });
    expect(pairsProblems([{ o: pairs[0].o, t: "Да." }]).some((problem) => problem.text.includes("длина"))).toBe(true);
  });

  it("tolerates a different number format, and asks to confirm a missing Latin name without blocking", () => {
    expect(pairsProblems([{ o: "The fee is 2.65% and 1,000 people applied.", t: "Взнос — 2,65%, подали заявки 1000 человек." }])).toEqual([]);
    const names = pairsProblems([{ o: "GeSY covers visits to a personal doctor.", t: "Система покрывает визиты к личному врачу." }]);
    expect(names).toHaveLength(1);
    expect(names[0].blocking).toBe(false);
  });

  it("lays the pairs out for reading", () => {
    expect(formatPairs(pairs)).toContain("1. ОРИГИНАЛ:\nCalls to 112");
    expect(formatPairs(pairs)).toContain("ПЕРЕВОД:\nЗвонки на 112");
  });
});
