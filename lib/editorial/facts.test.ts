import { describe, expect, it } from "vitest";

import {
  asFactEntries,
  cleanClaims,
  confirmFact,
  evaluateClaims,
  factItems,
  factSentences,
  normalizeForMatch,
  quoteFound,
  uncoveredSentences,
  type Claim,
} from "./facts";

const GESY = "https://www.gesy.org.cy/en-us/faq";
const PAGE =
  "Registration with a Personal Doctor is free of charge. Beneficiaries pay a co-payment of €1 per visit to a personal doctor.";

const claim = (overrides: Partial<Claim> = {}): Claim => ({
  claim: "За визит к личному врачу доплата 1 евро",
  importance: "critical",
  source_url: GESY,
  quote: "Beneficiaries pay a co-payment of €1 per visit",
  ...overrides,
});

const texts = (text = PAGE) => new Map([[GESY, { ok: true as const, text }]]);

describe("quote matching", () => {
  it("ignores case, spacing, typographic quotes and dashes", () => {
    expect(normalizeForMatch("«Co‑payment —  €1»")).toBe('"co-payment - €1"');
    expect(quoteFound(PAGE, "beneficiaries  PAY a co-payment of €1 per visit")).toBe(true);
  });

  it("rejects paraphrases and too-short quotes", () => {
    expect(quoteFound(PAGE, "Patients must pay one euro for each doctor visit")).toBe(false);
    expect(quoteFound(PAGE, "€1 per visit")).toBe(false);
  });
});

describe("evaluateClaims", () => {
  it("marks found quotes, missing quotes, unreadable sources and missing quotes text", () => {
    const entries = evaluateClaims(
      [
        claim(),
        claim({ claim: "Другое", quote: "Beneficiaries must register within 30 days of arrival" }),
        claim({ claim: "Без цитаты", quote: "" }),
        claim({ claim: "PDF-скан", source_url: "https://www.moh.gov.cy/scan.pdf", quote: "This is a scanned table of fees" }),
      ],
      new Map([
        [GESY, { ok: true as const, text: PAGE }],
        ["https://www.moh.gov.cy/scan.pdf", { ok: false as const, state: "no_text" as const, detail: "в PDF нет текста (скан?)" }],
      ]),
      [],
    );
    expect(entries.map((e) => e.state)).toEqual(["quote_found", "quote_not_found", "no_quote", "no_text"]);
  });

  it("keeps a manual confirmation only while the claim, quote and source are unchanged", () => {
    const [entry] = evaluateClaims([claim({ quote: "not on the page at all, really" })], texts(), []);
    const items = factItems([entry], "Текст без цифр.");
    const confirmed = confirmFact([entry], items[0], GESY, new Date("2026-11-14T10:00:00Z"));
    expect(confirmed[0].manual).toEqual({ at: "2026-11-14T10:00:00.000Z", sourceUrl: GESY });

    const same = evaluateClaims([claim({ quote: "not on the page at all, really" })], texts(), confirmed);
    expect(same[0].manual).not.toBeNull();

    for (const changed of [
      claim({ quote: "not on the page at all, really!" }),
      claim({ quote: "not on the page at all, really", claim: "Изменённое утверждение" }),
      claim({ quote: "not on the page at all, really", source_url: "https://www.gov.cy/other" }),
    ]) {
      expect(evaluateClaims([changed], texts(), confirmed)[0].manual).toBeNull();
    }
  });
});

describe("coverage of figures", () => {
  it("finds sentences with figures and ignores list numbering and 'current as of'", () => {
    const body = "## Коротко\n\n1. Зарегистрируйтесь у врача.\n\nИнформация по состоянию на ноябрь 2026 года.\n\nДоплата 1 евро за визит. Взнос 2,65% от зарплаты.";
    expect(factSentences(body)).toEqual(["Доплата 1 евро за визит.", "Взнос 2,65% от зарплаты."]);
    expect(uncoveredSentences(body, [claim()])).toEqual(["Взнос 2,65% от зарплаты."]);
  });

  it("makes uncovered sentences blocking until the editor confirms them; changing the sentence resets", () => {
    const body = "Взнос 2,65% от зарплаты.";
    const [item] = factItems([], body).filter((i) => i.kind === "sentence");
    expect(item.blocking).toBe(true);
    const confirmed = confirmFact([], item, "https://www.gov.cy/contributions");
    expect(factItems(confirmed, body).filter((i) => i.blocking).map((i) => i.kind)).toEqual(["no_claims"]);
    expect(factItems(confirmed, "Взнос 2,9% от зарплаты.").some((i) => i.kind === "sentence" && i.blocking)).toBe(true);
  });
});

describe("old drafts and bad input", () => {
  it("reads missing or malformed fact_checks as an empty, unchecked list", () => {
    expect(asFactEntries(null)).toEqual([]);
    expect(asFactEntries([{ foo: 1 }, "x"])).toEqual([]);
    expect(factItems([], "Без цифр.").map((i) => [i.kind, i.blocking])).toEqual([["no_claims", true]]);
  });

  it("cleans model claims", () => {
    expect(cleanClaims([{ claim: " A ", importance: "weird", source_url: GESY, quote: "q" }, { claim: "" }, null])).toEqual([
      { claim: "A", importance: "critical", source_url: GESY, quote: "q" },
    ]);
  });
});
