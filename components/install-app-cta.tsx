"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";

import type { FinderMessages } from "@/lib/i18n/types";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
}

declare global {
  interface Window {
    __pharmacyBeforeInstallPrompt?: BeforeInstallPromptEvent;
  }
}

type InstallMode = "browser-prompt" | "ios-instructions" | null;

const INSTALLED_MARKER_KEY = "pharmacy_pwa_installed_v1";

function hasInstalledMarker(): boolean {
  try {
    return window.localStorage.getItem(INSTALLED_MARKER_KEY) !== null;
  } catch {
    return false;
  }
}

function saveInstalledMarker(): void {
  try {
    window.localStorage.setItem(INSTALLED_MARKER_KEY, "true");
  } catch {
    // Storage can be unavailable without affecting installation behavior.
  }
}

function isStandalone(): boolean {
  return (
    window.matchMedia?.("(display-mode: standalone)").matches === true ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

function isIosSafari(): boolean {
  const userAgent = navigator.userAgent;
  const isIosDevice =
    /iPad|iPhone|iPod/.test(userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const isSafari =
    /Safari/.test(userAgent) &&
    !/(CriOS|FxiOS|EdgiOS|OPiOS|DuckDuckGo)/.test(userAgent);
  return isIosDevice && isSafari;
}

interface InstallState {
  mode: InstallMode;
  prompt: BeforeInstallPromptEvent | null;
}

const EMPTY_INSTALL_STATE: InstallState = { mode: null, prompt: null };

// Install availability is a fact about the browser tab, not about one React
// component instance. Client navigation between district URLs remounts the
// page subtree, so the state lives at module level: a remounted CTA reads the
// already-known answer on its first render instead of starting from "hidden".
let installState: InstallState = EMPTY_INSTALL_STATE;
let installDetectionStarted = false;
const installStateListeners = new Set<() => void>();
let removeInstallWindowListeners: (() => void) | null = null;

function setInstallState(next: InstallState): void {
  if (next.mode === installState.mode && next.prompt === installState.prompt) return;
  installState = next;
  installStateListeners.forEach((listener) => listener());
}

function startInstallDetection(): void {
  if (installDetectionStarted) return;
  installDetectionStarted = true;

  if (isStandalone() || hasInstalledMarker()) {
    window.__pharmacyBeforeInstallPrompt = undefined;
    return;
  }

  const handleBeforeInstallPrompt = (event: Event) => {
    event.preventDefault();
    window.__pharmacyBeforeInstallPrompt = undefined;
    setInstallState({
      mode: "browser-prompt",
      prompt: event as BeforeInstallPromptEvent,
    });
  };
  const handleAppInstalled = () => {
    saveInstalledMarker();
    setInstallState(EMPTY_INSTALL_STATE);
  };

  window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
  window.addEventListener("appinstalled", handleAppInstalled);
  removeInstallWindowListeners = () => {
    window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    window.removeEventListener("appinstalled", handleAppInstalled);
  };

  const capturedPrompt = window.__pharmacyBeforeInstallPrompt;
  window.__pharmacyBeforeInstallPrompt = undefined;
  if (capturedPrompt) {
    setInstallState({ mode: "browser-prompt", prompt: capturedPrompt });
  } else if (isIosSafari()) {
    setInstallState({ mode: "ios-instructions", prompt: null });
  }
}

function subscribeToInstallState(listener: () => void): () => void {
  installStateListeners.add(listener);
  startInstallDetection();
  return () => {
    installStateListeners.delete(listener);
  };
}

function getInstallState(): InstallState {
  return installState;
}

function getServerInstallState(): InstallState {
  return EMPTY_INSTALL_STATE;
}

/** Test-only: forget the detected state so each test starts from a fresh tab. */
export function resetInstallStateForTests(): void {
  removeInstallWindowListeners?.();
  removeInstallWindowListeners = null;
  installDetectionStarted = false;
  installState = EMPTY_INSTALL_STATE;
  installStateListeners.clear();
}

export function InstallAppCta({
  messages,
  reserveSpace = false,
}: {
  messages: Pick<
    FinderMessages,
    "installApp" | "installIosInstruction" | "installDialogClose"
  >;
  reserveSpace?: boolean;
}) {
  const { mode: installMode, prompt: installPrompt } = useSyncExternalStore(
    subscribeToInstallState,
    getInstallState,
    getServerInstallState,
  );
  const [showIosInstructions, setShowIosInstructions] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const ctaRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!showIosInstructions) return;
    const dialog = dialogRef.current;
    if (dialog && !dialog.open && typeof dialog.showModal === "function") {
      dialog.showModal();
    } else if (dialog && !dialog.open) {
      dialog.setAttribute("open", "");
    }
    closeRef.current?.focus();
  }, [showIosInstructions]);

  if (!installMode && !reserveSpace) return null;

  const closeInstructions = () => {
    setShowIosInstructions(false);
    ctaRef.current?.focus();
  };

  const handleInstall = async () => {
    if (installMode === "ios-instructions") {
      setShowIosInstructions(true);
      return;
    }
    if (!installPrompt) return;

    const prompt = installPrompt;
    setInstallState({ mode: installMode, prompt: null });
    await prompt.prompt();
    const choice = await prompt.userChoice;
    if (choice.outcome === "accepted") saveInstalledMarker();
    setInstallState(EMPTY_INSTALL_STATE);
  };

  return (
    <>
      <span aria-hidden="true" className="block h-16 lg:hidden" />
      {installMode && (
        <button
          ref={ctaRef}
          type="button"
          onClick={handleInstall}
          className="absolute bottom-6 right-4 min-h-11 rounded-xl bg-[#FF956A] px-4 py-2 text-sm font-medium text-[#32150a] transition-colors duration-200 hover:bg-[rgb(190,255,80)] focus-visible:bg-[rgb(190,255,80)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white sm:bottom-8 sm:right-6 lg:right-8"
        >
          {messages.installApp}
        </button>
      )}

      {showIosInstructions && (
        <dialog
          ref={dialogRef}
          aria-label={messages.installApp}
          onCancel={(event) => {
            event.preventDefault();
            closeInstructions();
          }}
          onClose={() => setShowIosInstructions(false)}
          className="fixed inset-0 z-[70] m-auto w-[calc(100%-2rem)] max-w-sm rounded-2xl border border-[var(--line)] bg-white p-0 text-[var(--ink)] shadow-[0_24px_70px_rgba(16,15,15,0.22)] backdrop:bg-black/35 backdrop:backdrop-blur-[2px]"
        >
          <div className="p-5 sm:p-6">
            <p className="text-base font-medium leading-6">
              {messages.installIosInstruction}
            </p>
            <button
              ref={closeRef}
              type="button"
              onClick={closeInstructions}
              className="mt-5 min-h-11 w-full rounded-xl border border-[var(--line-strong)] bg-white px-4 py-2 text-sm font-medium transition-colors hover:bg-[var(--surface-muted)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand)]"
            >
              {messages.installDialogClose}
            </button>
          </div>
        </dialog>
      )}
    </>
  );
}
