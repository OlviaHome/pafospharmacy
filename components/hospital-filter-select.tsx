'use client';

import { ChevronDown } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';

type Option = { value: string; label: string; lang?: string };

/**
 * Animated listbox select. "field" is the labelled filter control; "compact" is the same
 * control with a visually hidden label and a small trigger, used by the header language switch.
 */
export function HospitalFilterSelect({ label, value, options, onChange, variant = 'field', onPrepare }: {
  label: string;
  value: string;
  options: Option[];
  onChange: (value: string) => void;
  variant?: 'field' | 'compact';
  onPrepare?: () => void;
}) {
  const compact = variant === 'compact';
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [active, setActive] = useState(0);
  const [previous, setPrevious] = useState<string | null>(null);
  const [moving, setMoving] = useState(false);
  const chosen = options.find((option) => option.value === value) ?? options[0];
  const currentLabel = chosen.label;
  const lastLabel = useRef(currentLabel);

  useEffect(() => {
    if (lastLabel.current === currentLabel) return;
    setPrevious(lastLabel.current);
    setMoving(false);
    lastLabel.current = currentLabel;
    const frame = requestAnimationFrame(() => setMoving(true));
    const timeout = window.setTimeout(() => setPrevious(null), 210);
    return () => { cancelAnimationFrame(frame); clearTimeout(timeout); };
  }, [currentLabel]);

  useEffect(() => {
    if (open) return;
    const timeout = window.setTimeout(() => setMounted(false), 200);
    return () => clearTimeout(timeout);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function outside(event: PointerEvent) {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open]);

  function openAt(index: number) { setActive(index); setMounted(true); setOpen(true); }
  function select(index: number) { onChange(options[index].value); setOpen(false); trigger.current?.focus(); }
  function keyDown(event: React.KeyboardEvent<HTMLButtonElement>) {
    if (event.key === 'Escape') { if (open) { event.preventDefault(); setOpen(false); } return; }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!open) openAt(Math.max(0, options.findIndex(option => option.value === value)));
      else setActive((active + options.length + (event.key === 'ArrowDown' ? 1 : -1)) % options.length);
    } else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault(); openAt(event.key === 'Home' ? 0 : options.length - 1);
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault(); if (open) select(active); else openAt(Math.max(0, options.findIndex(option => option.value === value)));
    } else if (event.key === 'Tab') setOpen(false);
  }

  return <div ref={root} className={`relative ${compact ? 'w-32 shrink-0' : 'min-w-0'} ${open ? 'z-30' : 'z-0'}`}>
    <span id={`${id}-label`} className={compact ? 'sr-only' : 'mb-2 block text-sm font-medium text-[var(--ink)]'}>{label}</span>
    <button ref={trigger} type="button" aria-labelledby={`${id}-label ${id}-value`} aria-haspopup="listbox" aria-expanded={open} aria-controls={`${id}-list`} onFocus={onPrepare} onPointerEnter={onPrepare} onKeyDown={keyDown} onClick={() => { if (!open) openAt(Math.max(0, options.findIndex(option => option.value === value))); else setOpen(false); }} className={`flex w-full min-w-0 items-center justify-between rounded-xl border border-[var(--line-strong)] bg-white text-start text-sm outline-none transition-colors hover:border-[var(--brand)] focus-visible:border-[var(--brand)] focus-visible:ring-2 focus-visible:ring-[var(--brand)]/30 ${compact ? 'h-11 gap-2 ps-3 pe-2.5 font-bold text-[var(--brand-strong)]' : 'h-12 gap-3 ps-4 pe-[18px] text-[var(--ink)]'}`}>
      <span id={`${id}-value`} lang={chosen.lang} className={`relative block min-w-0 flex-1 overflow-hidden leading-5 ${compact ? 'text-center' : ''}`}><span className={`block truncate transition-[transform,opacity] duration-200 ease-out motion-reduce:transition-none ${previous && !moving ? 'translate-y-2 opacity-0' : 'translate-y-0 opacity-100'}`}>{currentLabel}</span>{previous && <span aria-hidden="true" className={`absolute inset-0 block truncate transition-[transform,opacity] duration-200 ease-out motion-reduce:hidden ${moving ? '-translate-y-2 opacity-0' : 'translate-y-0 opacity-100'}`}>{previous}</span>}</span>
      <ChevronDown aria-hidden="true" className={`${compact ? 'size-4' : 'size-5'} shrink-0 text-[var(--brand)] transition-transform duration-200 motion-reduce:transition-none ${open ? 'rotate-180' : ''}`} />
    </button>
    {mounted && <div id={`${id}-list`} role="listbox" aria-labelledby={`${id}-label`} className={`absolute inset-x-0 top-full z-40 mt-2 max-h-64 overflow-y-auto rounded-xl border border-[var(--line-strong)] bg-white p-1 shadow-[0_12px_30px_rgba(16,15,15,0.13)] transition-[opacity,transform] duration-200 ease-out motion-reduce:transition-none ${open ? 'translate-y-0 opacity-100' : '-translate-y-2 opacity-0 pointer-events-none'}`}>
      {options.map((option, index) => <button key={option.value} id={`${id}-option-${index}`} role="option" aria-selected={option.value === value} tabIndex={open ? 0 : -1} type="button" onMouseEnter={() => setActive(index)} onFocus={() => setActive(index)} onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); setOpen(false); trigger.current?.focus(); } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); const next = (index + options.length + (event.key === 'ArrowDown' ? 1 : -1)) % options.length; root.current?.querySelectorAll<HTMLButtonElement>('[role="option"]')[next]?.focus(); } else if (event.key === 'Home' || event.key === 'End') { event.preventDefault(); root.current?.querySelectorAll<HTMLButtonElement>('[role="option"]')[event.key === 'Home' ? 0 : options.length - 1]?.focus(); } }} lang={option.lang} onClick={() => select(index)} className={`flex min-h-11 w-full items-center rounded-lg px-3 py-2 text-sm ${compact ? 'justify-center text-center' : 'text-start'} outline-none transition-colors hover:bg-[var(--surface-muted)] focus-visible:bg-[var(--surface-muted)] focus-visible:ring-2 focus-visible:ring-[var(--brand)]/30 ${option.value === value ? 'bg-[var(--brand-soft)] font-bold text-[var(--brand-strong)]' : 'text-[var(--ink)]'}`}>{option.label}</button>)}
    </div>}
  </div>;
}
