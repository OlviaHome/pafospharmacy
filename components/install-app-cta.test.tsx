// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
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

function setLocalStorageMock() {
  const values = new Map<string, string>();
  const storage: Storage = {
    get length() {
      return values.size;
    },
    clear: vi.fn(() => values.clear()),
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    key: vi.fn((index: number) => Array.from(values.keys())[index] ?? null),
    removeItem: vi.fn((key: string) => values.delete(key)),
    setItem: vi.fn((key: string, value: string) => values.set(key, value)),
  };
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: storage,
  });
}

beforeEach(() => {
  window.__pharmacyBeforeInstallPrompt = undefined;
  setLocalStorageMock();
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
  it("reserves district-page hero space before and after iOS installation detection", async () => {
    setNavigatorValue(
      "userAgent",
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1",
    );
    setNavigatorValue("platform", "iPhone");

    const serverHtml = renderToStaticMarkup(
      <InstallAppCta messages={en.finder} reserveSpace />,
    );
    expect(serverHtml).toContain("h-16");
    expect(serverHtml).not.toContain("<button");

    const { container } = render(<InstallAppCta messages={en.finder} reserveSpace />);
    await screen.findByRole("button", { name: en.finder.installApp });
    expect(container.querySelectorAll("span.h-16")).toHaveLength(1);
  });

  it("uses an install prompt captured before hydration", async () => {
    const prompt = vi.fn().mockResolvedValue(undefined);
    window.__pharmacyBeforeInstallPrompt = Object.assign(
      new Event("beforeinstallprompt"),
      {
        prompt,
        userChoice: Promise.resolve({ outcome: "accepted" as const, platform: "web" }),
      },
    );

    render(<InstallAppCta messages={en.finder} />);
    fireEvent.click(
      await screen.findByRole("button", { name: en.finder.installApp }),
    );

    expect(prompt).toHaveBeenCalledTimes(1);
    expect(window.__pharmacyBeforeInstallPrompt).toBeUndefined();
    await waitFor(() => {
      expect(window.localStorage.getItem("pharmacy_pwa_installed_v1")).toBe(
        "true",
      );
    });
  });

  it("uses the captured browser install prompt and hides after acceptance", async () => {
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
    expect(window.localStorage.getItem("pharmacy_pwa_installed_v1")).toBe(
      "true",
    );
  });

  it("hides the CTA after the browser prompt is dismissed", async () => {
    const event = Object.assign(new Event("beforeinstallprompt"), {
      prompt: vi.fn().mockResolvedValue(undefined),
      userChoice: Promise.resolve({ outcome: "dismissed", platform: "web" }),
    });

    render(<InstallAppCta messages={en.finder} />);
    fireEvent(window, event);
    fireEvent.click(
      await screen.findByRole("button", { name: en.finder.installApp }),
    );

    await waitFor(() => {
      expect(
        screen.queryByRole("button", { name: en.finder.installApp }),
      ).toBeNull();
    });
    expect(window.localStorage.getItem("pharmacy_pwa_installed_v1")).toBeNull();
  });

  it("stores the marker and hides when the appinstalled event fires", async () => {
    render(<InstallAppCta messages={en.finder} />);
    fireEvent(
      window,
      Object.assign(new Event("beforeinstallprompt"), {
        prompt: vi.fn().mockResolvedValue(undefined),
        userChoice: Promise.resolve({ outcome: "accepted", platform: "web" }),
      }),
    );
    await screen.findByRole("button", { name: en.finder.installApp });

    fireEvent(window, new Event("appinstalled"));

    await waitFor(() => {
      expect(
        screen.queryByRole("button", { name: en.finder.installApp }),
      ).toBeNull();
    });
    expect(window.localStorage.getItem("pharmacy_pwa_installed_v1")).toBe(
      "true",
    );
  });

  it("stays hidden in a browser tab when the installed marker exists", async () => {
    window.localStorage.setItem("pharmacy_pwa_installed_v1", "true");

    render(<InstallAppCta messages={en.finder} />);

    await waitFor(() => {
      expect(
        screen.queryByRole("button", { name: en.finder.installApp }),
      ).toBeNull();
    });
  });

  it("stays hidden on desktop without a browser install prompt", async () => {
    render(<InstallAppCta messages={en.finder} />);

    await waitFor(() => {
      expect(
        screen.queryByRole("button", { name: en.finder.installApp }),
      ).toBeNull();
    });
    expect(screen.queryByRole("dialog")).toBeNull();
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
