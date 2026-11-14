import { describe, expect, it } from "vitest";

import {
  blockingFailures,
  failedChecks,
  prePublishChecks,
  scriptShare,
  type CheckableTranslation,
  type SourceCheck,
} from "./checks";
import { factId, type FactEntry } from "./facts";

const OFFICIAL = "https://www.gesy.org.cy/en-us/";
const BLOG = "https://example-blog.com/gesy";

const faq = (n: number) => Array.from({ length: n }, (_, i) => ({ question: `Q${i}?`, answer: "A." }));

function ru(words = 600): CheckableTranslation {
  return {
    locale: "ru",
    title: "Что такое ГеСИ и как зарегистрироваться",
    description: "Р".repeat(140),
    bodyMd: `## Коротко\n\n${"слово ".repeat(words)}\n\n[[image:inline-1]]\n\n## Шаги\n\nконец`,
    faq: faq(3),
    sources: [{ title: "Портал", url: OFFICIAL }],
  };
}

function translated(locale: CheckableTranslation["locale"], word: string, words = 600): CheckableTranslation {
  return {
    locale,
    title: "Title",
    description: "D".repeat(140),
    bodyMd: `## Short\n\n${`${word} `.repeat(words)}\n\n[[image:inline-1]]\n\n## Steps\n\nend`,
    faq: faq(3),
    sources: [{ title: "Portal", url: OFFICIAL }],
  };
}

function claimEntry(overrides: Partial<FactEntry> = {}): FactEntry {
  const claim = "Регистрация бесплатная";
  const quote = "registration with a personal doctor is free";
  return {
    id: factId("claim", claim, quote, OFFICIAL),
    kind: "claim",
    claim,
    importance: "critical",
    sourceUrl: OFFICIAL,
    quote,
    state: "quote_found",
    detail: null,
    checkedAt: "2026-11-14T00:00:00Z",
    manual: null,
    ...overrides,
  };
}

const ok: SourceCheck[] = [{ url: OFFICIAL, state: "ok", status: 200, checkedAt: "2026-11-10T00:00:00Z" }];
const facts = [claimEntry()];
const ids = (results: ReturnType<typeof prePublishChecks>) => failedChecks(results).map((r) => r.id);

describe("prePublishChecks", () => {
  it("passes a complete RU + EN article of practical length", () => {
    const results = prePublishChecks([ru(), translated("en", "word")], ["ru", "en"], ok, facts);
    expect(ids(results)).toEqual([]);
  });

  it("has no minimum length or FAQ count beyond catching cut-off text and padded FAQ", () => {
    expect(ids(prePublishChecks([{ ...ru(300), faq: [] }], ["ru"], ok, facts))).toEqual([]);
    expect(ids(prePublishChecks([ru(120)], ["ru"], ok, facts))).toEqual(["ru-words"]);
    expect(ids(prePublishChecks([{ ...ru(), faq: faq(7) }], ["ru"], ok, facts))).toEqual(["faq-ru"]);
  });

  it("checks description length and the search title", () => {
    expect(ids(prePublishChecks([{ ...ru(), description: "коротко" }], ["ru"], ok, facts))).toEqual(["description-ru"]);
    const long = { ...ru(), title: "Очень длинный заголовок статьи про ГеСИ, который точно не помещается в поиске" };
    expect(ids(prePublishChecks([long], ["ru"], ok, facts))).toContain("title-ru");
  });

  it("flags promises of real-time data", () => {
    const realtime = { ...ru(), bodyMd: `${ru().bodyMd}\n\nСписок обновляется в реальном времени.` };
    expect(ids(prePublishChecks([realtime], ["ru"], ok, facts))).toContain("realtime-ru");
  });

  it("flags a translation outdated by Russian edits", () => {
    const outdated = { ...translated("en", "word"), status: "draft" as const };
    expect(ids(prePublishChecks([ru(), outdated], ["ru", "en"], ok, facts))).toContain("outdated-en");
  });

  it("requires an official source and working links, which are not a fact check", () => {
    const unofficial = { ...ru(), sources: [{ title: "Blog", url: BLOG }] };
    const checks: SourceCheck[] = [{ url: BLOG, state: "broken", status: 404, checkedAt: "x" }];
    expect(ids(prePublishChecks([unofficial], ["ru"], checks, facts))).toEqual(
      expect.arrayContaining(["official-source", "links"]),
    );
    const linksOnly = prePublishChecks([ru()], ["ru"], ok, []);
    expect(linksOnly.find((r) => r.id === "links")?.ok).toBe(true);
    expect(blockingFailures(linksOnly).map((r) => r.id)).toEqual(["facts-critical"]);
  });

  it("checks translations by alphabet, structure and image places, not by length", () => {
    const leftInRussian = { ...translated("el", "слово"), locale: "el" as const };
    expect(ids(prePublishChecks([ru(), leftInRussian], ["el"], ok))).toContain("script-el");

    const shortButComplete = translated("ar", "كلمة", 150);
    expect(ids(prePublishChecks([ru(), shortButComplete], ["ar"], ok))).toEqual([]);

    const cut = { ...translated("en", "word"), bodyMd: "## Short\n\nword word\n\n[[image:inline-1]]" };
    expect(ids(prePublishChecks([ru(), cut], ["en"], ok))).toContain("structure-en");

    const moved = { ...translated("en", "word"), bodyMd: "## Short\n\nword\n\n## Steps\n\nend" };
    expect(ids(prePublishChecks([ru(), moved], ["en"], ok))).toContain("markers-en");
  });

  it("reports a missing language", () => {
    expect(ids(prePublishChecks([ru()], ["ru", "en"], ok, facts))).toContain("missing-en");
  });
});

describe("fact checks in prePublishChecks", () => {
  const blocking = (entries: FactEntry[], body = ru()) =>
    blockingFailures(prePublishChecks([body], ["ru"], ok, entries)).map((r) => r.id);

  it("blocks an empty claim list: no claims is never a passed check", () => {
    expect(blocking([])).toEqual(["facts-critical"]);
  });

  it("blocks a critical claim whose quote was not found until it is confirmed by hand", () => {
    const notFound = claimEntry({ state: "quote_not_found" });
    expect(blocking([notFound])).toEqual(["facts-critical"]);
    expect(blocking([{ ...notFound, manual: { at: "2026-11-14T10:00:00Z", sourceUrl: OFFICIAL } }])).toEqual([]);
  });

  it("only warns about normal claims without a found quote", () => {
    const normal = claimEntry({ importance: "normal", state: "no_text" });
    const results = prePublishChecks([ru()], ["ru"], ok, [normal]);
    expect(blockingFailures(results)).toEqual([]);
    expect(ids(results)).toEqual(["facts-normal"]);
  });

  it("blocks figures in the text that no claim covers", () => {
    const withFigure = { ...ru(), bodyMd: `${ru().bodyMd}\n\nВзнос составляет 2,65% от зарплаты.` };
    expect(blocking([claimEntry()], withFigure)).toEqual(["facts-critical"]);
  });

  it("does not run fact checks for EL/AR publication", () => {
    expect(blockingFailures(prePublishChecks([ru(), translated("el", "λέξη")], ["el"], ok, []))).toEqual([]);
  });
});

describe("scriptShare", () => {
  it("ignores URLs and markers", () => {
    expect(scriptShare("Γεια σου [σύνδεσμος](https://example.com/abc) [[image:inline-1]]", "el")).toBe(1);
    expect(scriptShare("Hello мир", "en")).toBeCloseTo(5 / 8);
  });
});
