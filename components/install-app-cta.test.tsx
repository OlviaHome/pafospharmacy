// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ar } from "@/lib/i18n/locales/ar";
import { el } from "@/lib/i18n/locales/el";
import { en } from "@/lib/i18n/locales/en";
import { ru } from "@/lib/i18n/locales/ru";

import { InstallAppCta, resetInstallStateForTests } from "./install-app-cta";

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
  resetInstallStateForTests();
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

const IOS_SAFARI_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1";

function installPromptEvent(outcome: "accepted" | "dismissed", prompt = vi.fn().mockResolvedValue(undefined)) {
  return Object.assign(new Event("beforeinstallprompt"), {
    prompt,
    userChoice: Promise.resolve({ outcome, platform: "web" }),
  });
}

describe("InstallAppCta", () => {
  it("is part of the server-rendered markup and reserves its hero space", () => {
    const serverHtml = renderToStaticMarkup(<InstallAppCta messages={en.finder} />);
    expect(serverHtml).toContain("<button");
    expect(serverHtml).toContain(en.finder.installApp);
    expect(serverHtml).toContain("h-16");
  });

  it("is visible without a browser install prompt and shows no dialog until pressed", () => {
    render(<InstallAppCta messages={en.finder} />);
    expect(screen.getByRole("button", { name: en.finder.installApp })).toBeTruthy();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("stays visible from the first render after a district-navigation remount", () => {
    const { rerender, container } = render(
      <InstallAppCta key="limassol" messages={en.finder} />,
    );
    for (const district of ["paphos", "nicosia", "limassol"]) {
      rerender(<InstallAppCta key={district} messages={en.finder} />);
      expect(container.querySelector("button")?.textContent).toBe(en.finder.installApp);
    }
    expect(container.querySelectorAll("span.h-16")).toHaveLength(1);
  });

  it("opens the browser install prompt when one is available and stays visible", async () => {
    const prompt = vi.fn().mockResolvedValue(undefined);
    render(<InstallAppCta messages={en.finder} />);
    fireEvent(window, installPromptEvent("accepted", prompt));

    fireEvent.click(screen.getByRole("button", { name: en.finder.installApp }));

    await waitFor(() => expect(prompt).toHaveBeenCalledTimes(1));
    expect(screen.getByRole("button", { name: en.finder.installApp })).toBeTruthy();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(window.localStorage.setItem).not.toHaveBeenCalled();
  });

  it("uses an install prompt captured before hydration", async () => {
    const prompt = vi.fn().mockResolvedValue(undefined);
    window.__pharmacyBeforeInstallPrompt = installPromptEvent("dismissed", prompt) as never;

    render(<InstallAppCta messages={en.finder} />);
    fireEvent.click(screen.getByRole("button", { name: en.finder.installApp }));

    await waitFor(() => expect(prompt).toHaveBeenCalledTimes(1));
    expect(window.__pharmacyBeforeInstallPrompt).toBeUndefined();
    expect(screen.getByRole("button", { name: en.finder.installApp })).toBeTruthy();
  });

  it("keeps the captured prompt usable after a remount", async () => {
    const prompt = vi.fn().mockResolvedValue(undefined);
    const { rerender } = render(<InstallAppCta key="limassol" messages={en.finder} />);
    fireEvent(window, installPromptEvent("accepted", prompt));

    rerender(<InstallAppCta key="paphos" messages={en.finder} />);
    fireEvent.click(screen.getByRole("button", { name: en.finder.installApp }));

    await waitFor(() => expect(prompt).toHaveBeenCalledTimes(1));
  });

  it("falls back to browser-menu instructions once the single-use prompt is spent", async () => {
    const prompt = vi.fn().mockResolvedValue(undefined);
    render(<InstallAppCta messages={en.finder} />);
    fireEvent(window, installPromptEvent("dismissed", prompt));
    const button = screen.getByRole("button", { name: en.finder.installApp });

    fireEvent.click(button);
    await waitFor(() => expect(prompt).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("dialog")).toBeNull();

    fireEvent.click(button);
    const dialog = await screen.findByRole("dialog", { name: en.finder.installApp });
    expect(dialog.textContent).toContain(en.finder.installBrowserInstruction);
    expect(prompt).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: en.finder.installApp })).toBeTruthy();
  });

  it("shows browser-menu instructions when opening the prompt fails", async () => {
    const prompt = vi.fn().mockRejectedValue(new Error("not allowed"));
    render(<InstallAppCta messages={en.finder} />);
    fireEvent(window, installPromptEvent("accepted", prompt));

    fireEvent.click(screen.getByRole("button", { name: en.finder.installApp }));

    const dialog = await screen.findByRole("dialog", { name: en.finder.installApp });
    expect(dialog.textContent).toContain(en.finder.installBrowserInstruction);
  });

  it("ignores the legacy installed marker and the appinstalled event for visibility", async () => {
    window.localStorage.setItem("pharmacy_pwa_installed_v1", "true");
    render(<InstallAppCta messages={en.finder} />);
    fireEvent(window, new Event("appinstalled"));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: en.finder.installApp })).toBeTruthy();
    });
  });

  it.each([en, ru, el, ar] as const)(
    "shows localized browser-menu instructions on desktop without a prompt for $locale",
    async (dictionary) => {
      render(
        <div dir={dictionary.locale === "ar" ? "rtl" : "ltr"}>
          <InstallAppCta messages={dictionary.finder} />
        </div>,
      );

      fireEvent.click(screen.getByRole("button", { name: dictionary.finder.installApp }));

      const dialog = await screen.findByRole("dialog", { name: dictionary.finder.installApp });
      expect(dialog.textContent).toContain(dictionary.finder.installBrowserInstruction);
      expect(dialog.textContent).not.toContain(dictionary.finder.installIosInstruction);
      expect(dialog.closest("[dir]")?.getAttribute("dir")).toBe(
        dictionary.locale === "ar" ? "rtl" : "ltr",
      );
    },
  );

  it.each([en, ru, el, ar] as const)(
    "shows localized home-screen instructions in iOS Safari for $locale",
    async (dictionary) => {
      setNavigatorValue("userAgent", IOS_SAFARI_UA);
      setNavigatorValue("platform", "iPhone");

      render(
        <div dir={dictionary.locale === "ar" ? "rtl" : "ltr"}>
          <InstallAppCta messages={dictionary.finder} />
        </div>,
      );

      fireEvent.click(screen.getByRole("button", { name: dictionary.finder.installApp }));

      const dialog = await screen.findByRole("dialog", { name: dictionary.finder.installApp });
      expect(dialog.textContent).toContain(dictionary.finder.installIosInstruction);
      expect(dialog.closest("[dir]")?.getAttribute("dir")).toBe(
        dictionary.locale === "ar" ? "rtl" : "ltr",
      );
    },
  );

  it("closes the instructions dialog and keeps the button", async () => {
    render(<InstallAppCta messages={en.finder} />);
    fireEvent.click(screen.getByRole("button", { name: en.finder.installApp }));
    await screen.findByRole("dialog", { name: en.finder.installApp });

    fireEvent.click(screen.getByRole("button", { name: en.finder.installDialogClose }));

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.getByRole("button", { name: en.finder.installApp })).toBeTruthy();
  });

  it.each([en, ru, el, ar] as const)(
    "stays visible when already running standalone and says so instead of installing again for $locale",
    async (dictionary) => {
      setStandaloneMatch(true);
      const prompt = vi.fn().mockResolvedValue(undefined);
      render(
        <div dir={dictionary.locale === "ar" ? "rtl" : "ltr"}>
          <InstallAppCta messages={dictionary.finder} />
        </div>,
      );
      fireEvent(window, installPromptEvent("accepted", prompt));

      fireEvent.click(screen.getByRole("button", { name: dictionary.finder.installApp }));

      const dialog = await screen.findByRole("dialog", { name: dictionary.finder.installApp });
      expect(dialog.textContent).toContain(dictionary.finder.installAlreadyInstalled);
      expect(prompt).not.toHaveBeenCalled();
      expect(screen.getByRole("button", { name: dictionary.finder.installApp })).toBeTruthy();
    },
  );

  it("treats iOS standalone (navigator.standalone) as already installed", async () => {
    setNavigatorValue("userAgent", IOS_SAFARI_UA);
    setNavigatorValue("platform", "iPhone");
    setNavigatorValue("standalone", true);
    render(<InstallAppCta messages={en.finder} />);

    fireEvent.click(screen.getByRole("button", { name: en.finder.installApp }));

    const dialog = await screen.findByRole("dialog", { name: en.finder.installApp });
    expect(dialog.textContent).toContain(en.finder.installAlreadyInstalled);
  });
});
