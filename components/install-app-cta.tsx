"use client";

import { useEffect, useRef, useState } from "react";

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

type InstructionKind = "ios" | "browser" | "installed";

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

// The CTA is always rendered; the browser's install prompt is only needed when
// the button is pressed. It is a fact about the browser tab, not about one
// React instance (district navigation remounts the page subtree), so it is kept
// at module level. Its presence never changes whether the button is visible.
let deferredPrompt: BeforeInstallPromptEvent | null = null;
let installDetectionStarted = false;
let removeInstallWindowListeners: (() => void) | null = null;

function startInstallDetection(): void {
  if (installDetectionStarted) return;
  installDetectionStarted = true;

  const handleBeforeInstallPrompt = (event: Event) => {
    event.preventDefault();
    window.__pharmacyBeforeInstallPrompt = undefined;
    deferredPrompt = event as BeforeInstallPromptEvent;
  };
  // A prompt can be used once; after installation there is nothing left to use.
  const handleAppInstalled = () => {
    deferredPrompt = null;
  };

  window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
  window.addEventListener("appinstalled", handleAppInstalled);
  removeInstallWindowListeners = () => {
    window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    window.removeEventListener("appinstalled", handleAppInstalled);
  };

  adoptCapturedPrompt();
}

/** Moves a prompt captured by the inline layout script (before hydration) into module state. */
function adoptCapturedPrompt(): void {
  const captured = window.__pharmacyBeforeInstallPrompt;
  window.__pharmacyBeforeInstallPrompt = undefined;
  if (captured) deferredPrompt = captured;
}

/** Returns the pending browser install prompt (if any) and forgets it: a prompt is single-use. */
function takeInstallPrompt(): BeforeInstallPromptEvent | null {
  adoptCapturedPrompt();
  const prompt = deferredPrompt;
  deferredPrompt = null;
  return prompt;
}

/** Test-only: forget the detected state so each test starts from a fresh tab. */
export function resetInstallStateForTests(): void {
  removeInstallWindowListeners?.();
  removeInstallWindowListeners = null;
  installDetectionStarted = false;
  deferredPrompt = null;
}

export function InstallAppCta({
  messages,
}: {
  messages: Pick<
    FinderMessages,
    | "installApp"
    | "installIosInstruction"
    | "installBrowserInstruction"
    | "installAlreadyInstalled"
    | "installDialogClose"
  >;
}) {
  const [instructions, setInstructions] = useState<InstructionKind | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const ctaRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    startInstallDetection();
  }, []);

  useEffect(() => {
    if (!instructions) return;
    const dialog = dialogRef.current;
    if (dialog && !dialog.open && typeof dialog.showModal === "function") {
      dialog.showModal();
    } else if (dialog && !dialog.open) {
      dialog.setAttribute("open", "");
    }
    closeRef.current?.focus();
  }, [instructions]);

  const closeInstructions = () => {
    setInstructions(null);
    ctaRef.current?.focus();
  };

  const handleInstall = async () => {
    // Already running as the installed app: do not offer a second installation.
    if (isStandalone()) {
      setInstructions("installed");
      return;
    }
    const prompt = takeInstallPrompt();
    if (prompt) {
      try {
        await prompt.prompt();
        await prompt.userChoice;
      } catch {
        setInstructions("browser");
      }
      return;
    }
    setInstructions(isIosSafari() ? "ios" : "browser");
  };

  const instructionText =
    instructions === "ios"
      ? messages.installIosInstruction
      : instructions === "installed"
        ? messages.installAlreadyInstalled
        : messages.installBrowserInstruction;

  return (
    <>
      <span aria-hidden="true" className="block h-16 lg:hidden" />
      <button
        ref={ctaRef}
        type="button"
        onClick={handleInstall}
        className="absolute bottom-6 right-4 min-h-11 rounded-xl bg-[#FF956A] px-4 py-2 text-sm font-medium text-[#32150a] transition-colors duration-200 hover:bg-[rgb(190,255,80)] focus-visible:bg-[rgb(190,255,80)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white sm:bottom-8 sm:right-6 lg:right-8"
      >
        {messages.installApp}
      </button>

      {instructions && (
        <dialog
          ref={dialogRef}
          aria-label={messages.installApp}
          onCancel={(event) => {
            event.preventDefault();
            closeInstructions();
          }}
          onClose={() => setInstructions(null)}
          className="fixed inset-0 z-[70] m-auto w-[calc(100%-2rem)] max-w-sm rounded-2xl border border-[var(--line)] bg-white p-0 text-[var(--ink)] shadow-[0_24px_70px_rgba(16,15,15,0.22)] backdrop:bg-black/35 backdrop:backdrop-blur-[2px]"
        >
          <div className="p-5 sm:p-6">
            <p className="text-base font-medium leading-6">
              {instructionText}
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
