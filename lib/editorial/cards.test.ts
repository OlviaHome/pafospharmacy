import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { renderFactsMenu } from "./cards";
import { evaluateClaims } from "./facts";
import type { EditorialPost } from "./store";

const GOV = "https://www.gov.cy/moh-phs";
const GESY = "https://www.gesy.org.cy/en-us/faq";

function post(factChecks: EditorialPost["factChecks"]): EditorialPost {
  return {
    number: 7,
    factChecks,
    translations: [{ locale: "ru", bodyMd: "Текст без цифр." }],
  } as unknown as EditorialPost;
}

describe("facts menu", () => {
  it("shows the claim, the source link, the reason and «Проверить вручную» when a source could not be read", () => {
    const entries = evaluateClaims(
      [
        { claim: "График дежурств публикует Фармацевтическая служба", importance: "critical", source_url: GOV, quote: "night pharmacies are published by the Pharmaceutical Services" },
        { claim: "Регистрация у личного врача бесплатна", importance: "critical", source_url: GESY, quote: "Registration with a Personal Doctor is free of charge" },
      ],
      new Map([
        [GOV, { ok: false as const, state: "source_unavailable" as const, detail: "сайт не пускает автоматическую проверку (HTTP 403)" }],
        [GESY, { ok: true as const, text: "Registration with a Personal Doctor is free of charge." }],
      ]),
      [],
    );
    const menu = renderFactsMenu(post(entries));
    expect(menu.text).toContain("🔴 <b>1.</b> График дежурств публикует Фармацевтическая служба");
    expect(menu.text).toContain("🔎 Проверить вручную — источник не открылся: сайт не пускает автоматическую проверку (HTTP 403)");
    expect(menu.text).toContain(`<a href="${GOV}">www.gov.cy</a>`);
    expect(menu.text).toContain("Цитата найдена: 1 · проверено вручную: 0 · требуют внимания: 1 (из них проверить вручную: 1)");
    expect(menu.text).toContain("а не что вывод статьи доказан");
    // The found quote is not listed as a problem, and the unread one has a confirm button.
    expect(menu.text).not.toContain("Регистрация у личного врача бесплатна");
    expect(menu.keyboard[0].map((button) => button.text)).toEqual(["✅ 1"]);
  });

  it("shows only as many facts as fit in one Telegram message, each with its own button, never a cut one", () => {
    const long = "очень длинное утверждение ".repeat(12);
    const entries = evaluateClaims(
      Array.from({ length: 8 }, (_, i) => ({
        claim: `${i + 1}. ${long}`,
        importance: "critical" as const,
        source_url: `${GOV}/page-${i}-${"x".repeat(80)}`,
        quote: "q".repeat(190),
      })),
      new Map(Array.from({ length: 8 }, (_, i) => [`${GOV}/page-${i}-${"x".repeat(80)}`, { ok: false as const, state: "source_unavailable" as const, detail: "сайт не пускает автоматическую проверку (HTTP 403) ".repeat(3) }])),
      [],
    );
    const menu = renderFactsMenu(post(entries));
    expect(menu.text.length).toBeLessThan(4000);
    const buttons = menu.keyboard.flat().filter((button) => button.callback_data?.startsWith("fok:"));
    expect(buttons.length).toBeGreaterThanOrEqual(1);
    expect(buttons.length).toBeLessThan(8);
    // Every button belongs to a fact that is actually on the screen.
    for (let n = 1; n <= buttons.length; n += 1) expect(menu.text).toContain(`<b>${n}.</b>`);
    expect(menu.text).not.toContain(`<b>${buttons.length + 1}.</b>`);
    expect(menu.text).toContain("…и ещё");
  });
});
