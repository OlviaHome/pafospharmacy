"use client";

import {
  createContext,
  useContext,
  useEffect,
  useRef,
  type RefObject,
  type ReactNode,
} from "react";

/**
 * One-time, very light card entrance (fade + 8px rise) shared by the Pharmacies and
 * Hospitals catalogs.
 *
 * - Cards are always visible in the server HTML; the hidden state is only ever applied
 *   from the IntersectionObserver callback, so without JS / observer they stay visible.
 * - A single module-level observer serves every card (no per-card observers or state).
 * - Cards already inside the viewport on first observation are left alone; only cards
 *   that start below the fold are hidden, so nothing flashes and layout never moves
 *   (opacity/transform only).
 * - Each card reveals once and is then unobserved. When the list itself changes (district,
 *   filter, search) the scope is frozen: pending cards become static, nothing else animates.
 * - Skipped entirely for prefers-reduced-motion (the CSS is also gated on it).
 */

type Scope = RefObject<{ frozen: boolean }>;

const RevealContext = createContext<Scope | null>(null);

const STAGGER_MS = 60;
const MAX_DELAY_MS = 80;
const CLEANUP_MS = 700;

let observer: IntersectionObserver | null = null;
const seen = new WeakSet<Element>();

function onIntersect(entries: IntersectionObserverEntry[]) {
  const revealing: IntersectionObserverEntry[] = [];

  for (const entry of entries) {
    const el = entry.target as HTMLElement;
    if (!seen.has(el)) {
      seen.add(el);
      if (entry.isIntersecting)
        observer?.unobserve(el); // already on screen: stay static
      else el.dataset.reveal = "pending";
    } else if (entry.isIntersecting) {
      revealing.push(entry);
    }
  }

  revealing
    .sort(
      (a, b) =>
        a.boundingClientRect.top - b.boundingClientRect.top ||
        a.boundingClientRect.left - b.boundingClientRect.left,
    )
    .forEach((entry, index) => {
      const el = entry.target as HTMLElement;
      observer?.unobserve(el);
      el.style.setProperty(
        "--reveal-delay",
        `${Math.min(index * STAGGER_MS, MAX_DELAY_MS)}ms`,
      );
      el.dataset.reveal = "shown";
      window.setTimeout(() => {
        delete el.dataset.reveal;
        el.style.removeProperty("--reveal-delay");
      }, CLEANUP_MS);
    });
}

function observe(el: HTMLElement): (() => void) | undefined {
  try {
    if (
      typeof IntersectionObserver === "undefined" ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      return undefined;
    }
    observer ??= new IntersectionObserver(onIntersect);
    observer.observe(el);
    return () => {
      observer?.unobserve(el);
      seen.delete(el);
    };
  } catch {
    return undefined;
  }
}

function freezeReveals() {
  observer?.disconnect();
  observer = null;
  document
    .querySelectorAll<HTMLElement>('[data-reveal="pending"]')
    .forEach((el) => delete el.dataset.reveal);
}

/** Call in the component that owns the list. `signature` identifies the current result set. */
export function useRevealScope(signature: string): Scope {
  const scope = useRef({ frozen: false });
  const last = useRef(signature);

  useEffect(() => {
    if (last.current === signature) return;
    last.current = signature;
    scope.current.frozen = true;
    freezeReveals();
  }, [scope, signature]);

  return scope;
}

export function RevealScope({
  scope,
  children,
}: {
  scope: Scope;
  children: ReactNode;
}) {
  return (
    <RevealContext.Provider value={scope}>{children}</RevealContext.Provider>
  );
}

export function useRevealOnScroll<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const scope = useContext(RevealContext);

  useEffect(() => {
    const el = ref.current;
    if (!el || !scope || scope.current.frozen) return;
    return observe(el);
  }, [scope]);

  return ref;
}

export function RevealItem({
  as: Tag = "div",
  className,
  children,
}: {
  as?: "div" | "li";
  className?: string;
  children: ReactNode;
}) {
  const ref = useRevealOnScroll<HTMLElement>();
  return (
    <Tag ref={ref as never} className={className}>
      {children}
    </Tag>
  );
}
