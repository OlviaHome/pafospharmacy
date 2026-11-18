import { describe, expect, it } from "vitest";

import { checkOriginality, ORIGINALITY } from "./originality";
import {
  CLOSE_TRANSLATION_RU,
  INDEPENDENT_RU,
  LIGHT_PARAPHRASE_RU,
  NAMES_AND_QUOTE_RU,
  ONE_COPIED_PARAGRAPH_RU,
  SOURCE_EN,
  SOURCE_EN_WORKING_RU,
  SOURCE_RU,
} from "./originality.fixtures";

describe("independence of an imported article (thresholds tuned on these examples)", () => {
  it("passes an article written from scratch around the reader's questions", () => {
    const result = checkOriginality(INDEPENDENT_RU, [SOURCE_RU]);
    expect(result).toMatchObject({ blocked: false, longestRun: 0 });
  });

  it("blocks a light paraphrase that keeps the source's paragraphs", () => {
    const result = checkOriginality(LIGHT_PARAPHRASE_RU, [SOURCE_RU]);
    expect(result.blocked).toBe(true);
    expect(result.longestRun).toBeGreaterThanOrEqual(ORIGINALITY.maxSharedRun);
    expect(result.orderRun).toBeGreaterThanOrEqual(ORIGINALITY.orderRun);
  });

  it("blocks an independent article with one paragraph pasted from the source, and shows it", () => {
    const result = checkOriginality(ONE_COPIED_PARAGRAPH_RU, [SOURCE_RU]);
    expect(result.blocked).toBe(true);
    expect(result.fragments[0]).toContain("подготовка персонала может занять больше времени");
  });

  it("does not count official names or a quoted statement", () => {
    const result = checkOriginality(NAMES_AND_QUOTE_RU, [SOURCE_RU]);
    expect(result.blocked).toBe(false);
    expect(result.longestRun).toBe(0);
  });

  it("passes a short ordinary phrase shared with the source", () => {
    const article = `${INDEPENDENT_RU}\n\nВсе бригады перейдут под единое управление, сообщает министерство.`;
    const result = checkOriginality(article, [SOURCE_RU]);
    expect(result.blocked).toBe(false);
    expect(result.longestRun).toBeLessThan(ORIGINALITY.maxSharedRun);
  });

  it("passes an independent article written from an English source", () => {
    expect(checkOriginality(INDEPENDENT_RU, [SOURCE_EN, SOURCE_EN_WORKING_RU]).blocked).toBe(false);
  });

  it("blocks a close translation of an English source even when its words differ from the working translation", () => {
    const result = checkOriginality(CLOSE_TRANSLATION_RU, [SOURCE_EN, SOURCE_EN_WORKING_RU]);
    expect(result.longestRun).toBe(0);
    expect(result.blocked).toBe(true);
    expect(result.reasons.join(" ")).toContain("пересказывают исходник в его порядке");
  });

  it("blocks the working translation itself", () => {
    expect(checkOriginality(SOURCE_EN_WORKING_RU, [SOURCE_EN, SOURCE_EN_WORKING_RU]).blocked).toBe(true);
  });

  it("has nothing to compare without material", () => {
    expect(checkOriginality(INDEPENDENT_RU, []).blocked).toBe(false);
  });
});
