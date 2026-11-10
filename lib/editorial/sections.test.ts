import { describe, expect, it } from "vitest";

import {
  formatFaq,
  formatSources,
  insertImageMarker,
  nextInlineSlot,
  parseFaq,
  parseSources,
  removeImageMarker,
  replaceSection,
  splitSections,
} from "./sections";

const body = "## Коротко\n\n- раз\n- два\n\n## Кто может?\n\nВсе резиденты.\n\n[[image:inline-1]]\n\n## Как зарегистрироваться?\n\nШаги.";

describe("sections", () => {
  it("splits by ## headings and keeps text before the first heading", () => {
    const sections = splitSections(`Вступление.\n\n${body}`);
    expect(sections.map((s) => s.heading)).toEqual([null, "Коротко", "Кто может?", "Как зарегистрироваться?"]);
    expect(sections[2].text).toContain("[[image:inline-1]]");
  });

  it("replaces one section and leaves the others", () => {
    const next = replaceSection(body, 1, "## Кто может пользоваться?\n\nРезиденты и их семьи.");
    expect(splitSections(next).map((s) => s.heading)).toEqual(["Коротко", "Кто может пользоваться?", "Как зарегистрироваться?"]);
    expect(next).not.toContain("[[image:inline-1]]");
    expect(next).toContain("Шаги.");
  });

  it("removes a section when the replacement is empty", () => {
    expect(splitSections(replaceSection(body, 0, " "))).toHaveLength(2);
  });

  it("inserts and removes image markers", () => {
    const withImage = insertImageMarker(body, 2, "inline-2");
    expect(splitSections(withImage)[2].text.endsWith("[[image:inline-2]]")).toBe(true);
    expect(removeImageMarker(withImage, "inline-1")).not.toContain("inline-1");
    expect(nextInlineSlot(["cover", "inline-1", "inline-3"])).toBe("inline-2");
  });
});

describe("FAQ text", () => {
  it("round-trips and accepts Q/A and multi-line answers", () => {
    const faq = [
      { question: "Это бесплатно?", answer: "Есть взносы." },
      { question: "Где регистрироваться?", answer: "На портале." },
    ];
    expect(parseFaq(formatFaq(faq))).toEqual(faq);
    expect(parseFaq("Q: Free?\nA: Mostly.\nSee the portal.\n\nQ: Empty?")).toEqual([
      { question: "Free?", answer: "Mostly.\nSee the portal." },
    ]);
  });
});

describe("sources text", () => {
  it("reads titled lines and bare URLs, https only, no duplicates", () => {
    const text = "Портал ГеСИ | https://www.gesy.org.cy/\nhttps://www.moh.gov.cy/page.\nhttp://insecure.example\nhttps://www.gesy.org.cy/";
    expect(parseSources(text)).toEqual([
      { title: "Портал ГеСИ", url: "https://www.gesy.org.cy/" },
      { title: "www.moh.gov.cy", url: "https://www.moh.gov.cy/page" },
    ]);
    expect(parseSources(formatSources([{ title: "A", url: "https://a.gov.cy/x" }]))).toEqual([
      { title: "A", url: "https://a.gov.cy/x" },
    ]);
  });
});
