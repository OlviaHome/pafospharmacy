// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LOCALE_COOKIE_NAME } from "@/lib/i18n/config";

import { LanguageSelector } from "./language-selector";

const navigation = vi.hoisted(() => ({ push: vi.fn(), prefetch: vi.fn() }));

vi.mock("next/navigation", () => ({
  usePathname: () => "/en/privacy",
  useRouter: () => navigation,
}));

afterEach(() => {
  cleanup();
  navigation.push.mockReset();
  document.cookie = `${LOCALE_COOKIE_NAME}=; Max-Age=0; Path=/`;
});

function chooseLanguage(name: string) {
  fireEvent.click(screen.getByRole("button", { name: /Language/ }));
  fireEvent.click(screen.getByRole("option", { name }));
}

describe("LanguageSelector", () => {
  it("preserves the equivalent page and query while saving the explicit choice", () => {
    window.history.replaceState({}, "", "/en/privacy?from=finder");
    render(<LanguageSelector locale="en" label="Language" />);

    chooseLanguage("العربية");

    expect(navigation.push).toHaveBeenCalledWith("/ar/privacy?from=finder");
    expect(document.cookie).toContain(`${LOCALE_COOKIE_NAME}=ar`);
  });

  it("drops the article-language choice so the article follows the new site language", () => {
    window.history.replaceState({}, "", "/en/privacy?lang=ru&from=finder");
    render(<LanguageSelector locale="en" label="Language" />);

    chooseLanguage("Ελληνικά");

    expect(navigation.push).toHaveBeenCalledWith("/el/privacy?from=finder");
  });

  it("offers all four supported language names", () => {
    render(<LanguageSelector locale="en" label="Language" />);
    fireEvent.click(screen.getByRole("button", { name: /Language/ }));
    expect(screen.getByRole("option", { name: "English" })).toBeTruthy();
    expect(screen.getByRole("option", { name: "Ελληνικά" })).toBeTruthy();
    expect(screen.getByRole("option", { name: "Русский" })).toBeTruthy();
    expect(screen.getByRole("option", { name: "العربية" })).toBeTruthy();
  });

  it("marks the current language as selected and exposes each name in its own language", () => {
    render(<LanguageSelector locale="ru" label="Language" />);
    fireEvent.click(screen.getByRole("button", { name: /Language/ }));
    expect(screen.getByRole("option", { name: "Русский" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("option", { name: "العربية" }).getAttribute("lang")).toBe("ar");
  });
});
