// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LOCALE_COOKIE_NAME } from "@/lib/i18n/config";

import { LanguageSelector } from "./language-selector";

const navigation = vi.hoisted(() => ({ push: vi.fn() }));

vi.mock("next/navigation", () => ({
  usePathname: () => "/en/privacy",
  useRouter: () => navigation,
}));

afterEach(() => {
  cleanup();
  navigation.push.mockReset();
  document.cookie = `${LOCALE_COOKIE_NAME}=; Max-Age=0; Path=/`;
});

describe("LanguageSelector", () => {
  it("preserves the equivalent page and query while saving the explicit choice", () => {
    window.history.replaceState({}, "", "/en/privacy?from=finder");
    render(<LanguageSelector locale="en" label="Language" />);

    fireEvent.change(screen.getByRole("combobox", { name: "Language" }), {
      target: { value: "ar" },
    });

    expect(navigation.push).toHaveBeenCalledWith("/ar/privacy?from=finder");
    expect(document.cookie).toContain(`${LOCALE_COOKIE_NAME}=ar`);
  });

  it("offers all four supported language names", () => {
    render(<LanguageSelector locale="en" label="Language" />);
    expect(screen.getByRole("option", { name: "English" })).toBeTruthy();
    expect(screen.getByRole("option", { name: "Ελληνικά" })).toBeTruthy();
    expect(screen.getByRole("option", { name: "Русский" })).toBeTruthy();
    expect(screen.getByRole("option", { name: "العربية" })).toBeTruthy();
  });
});
