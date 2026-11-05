// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ar } from "@/lib/i18n/locales/ar";
import { el } from "@/lib/i18n/locales/el";
import { en } from "@/lib/i18n/locales/en";
import { ru } from "@/lib/i18n/locales/ru";

import { InstallAppCta } from "./install-app-cta";

function setNavigatorValue(name: string, value: unknown) {
  Object.defineProperty(window.navigator, name, {
    configurable: true,
    value,
  });
}

function setStandaloneMatch(matches: boolean) {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn(() => ({
      matches,
      media: "(display-mode: standalone)",
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

beforeEach(() => {
  setStandaloneMatch(false);
  setNavigatorValue("userAgent", "Mozilla/5.0 Chrome/141.0.0.0 Safari/537.36");
  setNavigatorValue("platform", "Linux x86_64");
  setNavigatorValue("maxTouchPoints", 0);
  setNavigatorValue("standalone", false);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("InstallAppCta", () => {
  it("uses the captured browser install prompt and hides after the choice", async () => {
    const prompt = vi.fn().mockResolvedValue(undefined);
    const event = Object.assign(new Event("beforeinstallprompt"), {
      prompt,
      userChoice: Promise.resolve({ outcome: "accepted", platform: "web" }),
    });

    render(<InstallAppCta messages={en.finder} />);
    expect(screen.queryByRole("button", { name: en.finder.installApp })).toBeNull();

    fireEvent(window, event);
    fireEvent.click(
      await screen.findByRole("button", { name: en.finder.installApp }),
    );

    expect(prompt).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(
        screen.queryByRole("button", { name: en.finder.installApp }),
      ).toBeNull();
    });
  });

  it("stays visible without a browser install prompt and shows brief guidance", async () => {
    render(<InstallAppCta messages={en.finder} />);

    fireEvent.click(
      await screen.findByRole("button", { name: en.finder.installApp }),
    );

    const dialog = await screen.findByRole("dialog", {
      name: en.finder.installApp,
    });
    expect(dialog.textContent).toContain(en.finder.installBrowserInstruction);
    expect(
      screen.getByRole("button", { name: en.finder.installApp }),
    ).toBeTruthy();
  });

  it.each([en, ru, el, ar] as const)(
    "shows localized home-screen instructions in iOS Safari for $locale",
    async (dictionary) => {
      setNavigatorValue(
        "userAgent",
        "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1",
      );
      setNavigatorValue("platform", "iPhone");

      render(
        <div dir={dictionary.locale === "ar" ? "rtl" : "ltr"}>
          <InstallAppCta messages={dictionary.finder} />
        </div>,
      );

      fireEvent.click(
        await screen.findByRole("button", {
          name: dictionary.finder.installApp,
        }),
      );

      const dialog = await screen.findByRole("dialog", {
        name: dictionary.finder.installApp,
      });
      expect(dialog.textContent).toContain(dictionary.finder.installIosInstruction);
      expect(dialog.closest("[dir]")?.getAttribute("dir")).toBe(
        dictionary.locale === "ar" ? "rtl" : "ltr",
      );
    },
  );

  it("stays hidden when the site is already running standalone", async () => {
    setStandaloneMatch(true);
    setNavigatorValue(
      "userAgent",
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1",
    );

    render(<InstallAppCta messages={en.finder} />);

    await waitFor(() => {
      expect(
        screen.queryByRole("button", { name: en.finder.installApp }),
      ).toBeNull();
    });
  });
});
