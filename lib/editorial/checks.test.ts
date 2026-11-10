import { describe, expect, it } from "vitest";

import { failedChecks, prePublishChecks, scriptShare, type CheckableTranslation, type SourceCheck } from "./checks";

const SITE = { ru: "Cyprus Pharmacy", en: "Cyprus Pharmacy", el: "Cyprus Pharmacy", ar: "Cyprus Pharmacy" };
const OFFICIAL = "https://www.gesy.org.cy/en-us/";
const BLOG = "https://example-blog.com/gesy";

const faq = (n: number) => Array.from({ length: n }, (_, i) => ({ question: `Q${i}?`, answer: "A." }));

function ru(words = 800): CheckableTranslation {
  return {
    locale: "ru",
    title: "Что такое ГеСИ и как зарегистрироваться",
    description: "Р".repeat(140),
    bodyMd: `${"слово ".repeat(words)}\n\n[[image:inline-1]]\n\nконец`,
    faq: faq(4),
    sources: [{ title: "Портал", url: OFFICIAL }],
  };
}

function translated(locale: CheckableTranslation["locale"], word: string, words = 800): CheckableTranslation {
  return {
    locale,
    title: "Title",
    description: "D".repeat(140),
    bodyMd: `${`${word} `.repeat(words)}\n\n[[image:inline-1]]\n\nend`,
    faq: faq(4),
    sources: [{ title: "Portal", url: OFFICIAL }],
  };
}

const ok: SourceCheck[] = [{ url: OFFICIAL, state: "ok", status: 200, checkedAt: "2026-11-10T00:00:00Z" }];
const ids = (results: ReturnType<typeof prePublishChecks>) => failedChecks(results).map((r) => r.id);

describe("prePublishChecks", () => {
  it("passes a complete RU + EN article", () => {
    const results = prePublishChecks([ru(), translated("en", "слово".replace(/./g, "w"))], ["ru", "en"], ok, SITE);
    expect(ids(results)).toEqual([]);
  });

  it("flags a short Russian text, few FAQ items and description length", () => {
    const short = { ...ru(300), faq: faq(2), description: "коротко" };
    expect(ids(prePublishChecks([short], ["ru"], ok, SITE))).toEqual(["ru-words", "description-ru", "faq-ru"]);
  });

  it("measures the title as shown in search, with the site name only when it fits", () => {
    const long = { ...ru(), title: "Очень длинный заголовок статьи про ГеСИ, который точно не помещается в поиске" };
    expect(ids(prePublishChecks([long], ["ru"], ok, SITE))).toContain("title-ru");
    const medium = { ...ru(), title: "Заголовок на пятьдесят символов ровно для проверки" };
    expect(ids(prePublishChecks([medium], ["ru"], ok, SITE))).not.toContain("title-ru");
  });

  it("requires an official source and working links", () => {
    const unofficial = { ...ru(), sources: [{ title: "Blog", url: BLOG }] };
    const checks: SourceCheck[] = [{ url: BLOG, state: "broken", status: 404, checkedAt: "x" }];
    const failed = ids(prePublishChecks([unofficial], ["ru"], checks, SITE));
    expect(failed).toEqual(expect.arrayContaining(["official-source", "links"]));
  });

  it("treats unchecked and refused links as problems the editor must confirm", () => {
    const refused: SourceCheck[] = [{ url: OFFICIAL, state: "unverified", status: 403, checkedAt: "x" }];
    expect(ids(prePublishChecks([ru()], ["ru"], refused, SITE))).toEqual(["links"]);
    expect(ids(prePublishChecks([ru()], ["ru"], [], SITE))).toEqual(["links"]);
  });

  it("catches a translation left in Russian, a truncated one and moved images", () => {
    const leftInRussian = { ...translated("el", "слово"), locale: "el" as const };
    expect(ids(prePublishChecks([ru(), leftInRussian], ["el"], ok, SITE))).toContain("script-el");

    const truncated = translated("ar", "كلمة", 100);
    expect(ids(prePublishChecks([ru(), truncated], ["ar"], ok, SITE))).toContain("length-ar");

    const moved = { ...translated("en", "word"), bodyMd: "word ".repeat(900) };
    expect(ids(prePublishChecks([ru(), moved], ["en"], ok, SITE))).toContain("markers-en");
  });

  it("reports a missing language", () => {
    expect(ids(prePublishChecks([ru()], ["ru", "en"], ok, SITE))).toContain("missing-en");
  });
});

describe("scriptShare", () => {
  it("ignores URLs and markers", () => {
    expect(scriptShare("Γεια σου [σύνδεσμος](https://example.com/abc) [[image:inline-1]]", "el")).toBe(1);
    expect(scriptShare("Hello мир", "en")).toBeCloseTo(5 / 8);
  });
});
