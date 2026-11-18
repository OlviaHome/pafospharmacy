import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { fitHtml } = await import("./telegram");

describe("fitHtml", () => {
  it("leaves a short text alone", () => {
    expect(fitHtml("<b>Привет</b>")).toBe("<b>Привет</b>");
  });

  it("never leaves a half-written tag at the cut", () => {
    const text = `${"а".repeat(3975)}<a href="https://example.com/very/long/address">ссылка</a> хвост ${"б".repeat(200)}`;
    const cut = fitHtml(text);
    expect(cut.length).toBeLessThanOrEqual(4000);
    expect(cut.lastIndexOf("<")).toBeLessThanOrEqual(cut.lastIndexOf(">"));
    expect(cut).not.toContain("<a href");
  });

  it("closes tags that are still open at the cut", () => {
    const cut = fitHtml(`<b>${"в".repeat(5000)}</b>`);
    expect(cut.endsWith("…</b>")).toBe(true);
    const nested = fitHtml(`<b>x <i>${"в".repeat(5000)}</i></b>`);
    expect(nested.endsWith("…</i></b>")).toBe(true);
  });

  it("does not cut an entity in half", () => {
    const cut = fitHtml(`${"а".repeat(3985)}&amp; ${"б".repeat(100)}`);
    expect(cut).not.toMatch(/&[a-z]*…/);
  });

  it("keeps tags that were closed before the cut balanced", () => {
    const cut = fitHtml(`<b>заголовок</b>\n<code>код</code>\n${"г".repeat(5000)}`);
    expect(cut).not.toContain("</code></code>");
    expect(cut.endsWith("…")).toBe(true);
  });
});
