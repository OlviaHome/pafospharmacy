import { createHash } from "node:crypto";

import { getCyprusDayWindow, localDateTimeToInstant } from "@/lib/domain/date";

/*
 * Editorial calendar: pure rules, no database and no Telegram. Slots are local Cyprus clock times
 * (Europe/Nicosia); each slot is turned into an instant for its own date, so 10:00 stays 10:00
 * on both sides of the summer/winter change.
 */

/** Shown to the editor. Europe/Nicosia and Asia/Nicosia are the same zone in the tz database. */
export const SCHEDULE_TIME_ZONE = "Europe/Nicosia";
export const DEFAULT_SLOT_TIMES = ["10:00", "17:00"] as const;
export const MAX_SLOTS_PER_DAY = 6;
/** The queue is checked every 15 minutes, so publication times sit on that grid. */
export const SLOT_STEP_MINUTES = 15;
/** A slot closer than this to now is not offered: the editor needs time to confirm. */
export const MIN_LEAD_MS = 5 * 60_000;
/** A slot this late is not published automatically any more: the editor decides. */
export const MISSED_AFTER_MS = 90 * 60_000;
/** A publication that started this long ago and never finished was interrupted. */
export const STUCK_PUBLISHING_MS = 10 * 60_000;
/** How far ahead a date may be chosen. */
export const MAX_DAYS_AHEAD = 365;
/** Pseudo check id for «места без картинки», a warning the manual publish flow shows too. */
export const MISSING_IMAGES_WARNING = "images-missing";

const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

export interface LocalSlot {
  /** YYYY-MM-DD in Cyprus. */
  date: string;
  /** HH:MM in Cyprus. */
  time: string;
}

export function isOnGrid(time: string): boolean {
  const match = TIME_PATTERN.exec(time);
  return Boolean(match && Number(match[2]) % SLOT_STEP_MINUTES === 0);
}

function normalizeTime(raw: string): string | null {
  const match = /^(\d{1,2})[:.](\d{2})$/.exec(raw.trim());
  if (!match) return null;
  const time = `${match[1].padStart(2, "0")}:${match[2]}`;
  return TIME_PATTERN.test(time) ? time : null;
}

export type TimesResult = { ok: true; times: string[] } | { ok: false; reason: string };

/** "10:00, 17:00" / "10.00 17:30" → sorted unique times on the 15-minute grid. */
export function parseTimes(text: string): TimesResult {
  const parts = text.split(/[\s,;]+/).filter(Boolean);
  if (parts.length === 0) return { ok: false, reason: "Напишите время через запятую, например: 10:00, 17:00" };
  const times: string[] = [];
  for (const part of parts) {
    const time = normalizeTime(part);
    if (!time) return { ok: false, reason: `Не понимаю время «${part}». Формат: ЧЧ:ММ, например 10:00` };
    if (!isOnGrid(time)) return { ok: false, reason: `${time}: минуты должны быть 00, 15, 30 или 45 — очередь проверяется раз в 15 минут` };
    if (!times.includes(time)) times.push(time);
  }
  if (times.length > MAX_SLOTS_PER_DAY) return { ok: false, reason: `Не больше ${MAX_SLOTS_PER_DAY} публикаций в день` };
  return { ok: true, times: times.sort() };
}

/** Reasonable times for a number of publications per day; the editor can change them. */
export function defaultTimesFor(count: number): string[] {
  const presets: Record<number, string[]> = {
    1: ["10:00"],
    2: ["10:00", "17:00"],
    3: ["09:00", "13:00", "18:00"],
    4: ["09:00", "12:00", "15:00", "18:00"],
    5: ["09:00", "11:00", "13:00", "15:00", "18:00"],
    6: ["09:00", "11:00", "13:00", "15:00", "17:00", "19:00"],
  };
  return presets[Math.min(MAX_SLOTS_PER_DAY, Math.max(1, Math.floor(count)))];
}

const localFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: SCHEDULE_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** The Cyprus date and clock time of an instant. */
export function localSlotOf(instant: Date): LocalSlot {
  const parts = Object.fromEntries(localFormatter.formatToParts(instant).map((part) => [part.type, part.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
}

/**
 * The instant of a Cyprus date and time, or null when that clock time does not exist that day
 * (the hour skipped when summer time starts).
 */
export function slotInstant(slot: LocalSlot): Date | null {
  const [year, month, day] = slot.date.split("-").map(Number);
  const [hour, minute] = slot.time.split(":").map(Number);
  if (![year, month, day, hour, minute].every(Number.isInteger)) return null;
  const instant = localDateTimeToInstant({ year, month, day, hour, minute });
  const back = localSlotOf(instant);
  return back.date === slot.date && back.time === slot.time ? instant : null;
}

/** Cyprus calendar date `offset` days from now. */
export function localDateAfter(now: Date, offset: number): string {
  return getCyprusDayWindow(now, offset).localDate;
}

/**
 * The next free slots of the daily schedule after now (+ lead time), skipping occupied instants.
 * Already scheduled articles, whatever their mode, occupy their exact instant.
 */
export function nextFreeSlots(
  times: readonly string[],
  occupied: Iterable<number>,
  now: Date,
  count = 1,
  options: { leadMs?: number; horizonDays?: number } = {},
): Date[] {
  const taken = new Set(occupied);
  const earliest = now.getTime() + (options.leadMs ?? MIN_LEAD_MS);
  const sorted = [...times].sort();
  const result: Date[] = [];
  if (sorted.length === 0 || count <= 0) return result;
  for (let offset = 0; offset <= (options.horizonDays ?? MAX_DAYS_AHEAD); offset += 1) {
    const date = localDateAfter(now, offset);
    for (const time of sorted) {
      const instant = slotInstant({ date, time });
      if (!instant || instant.getTime() < earliest || taken.has(instant.getTime())) continue;
      result.push(instant);
      taken.add(instant.getTime());
      if (result.length >= count) return result;
    }
  }
  return result;
}

export interface QueueEntryTiming {
  id: string;
  at: Date;
  mode: "queue" | "manual";
}

export interface Move {
  id: string;
  from: Date;
  to: Date;
}

/**
 * «Перераспределить очередь»: queue entries move, in their current order, onto the next free slots
 * of the new schedule. Entries planned by hand keep their times and occupy them.
 */
export function planRedistribution(entries: QueueEntryTiming[], times: readonly string[], now: Date): Move[] {
  const manual = entries.filter((entry) => entry.mode === "manual").map((entry) => entry.at.getTime());
  const queue = entries.filter((entry) => entry.mode === "queue").sort((a, b) => a.at.getTime() - b.at.getTime());
  const slots = nextFreeSlots(times, manual, now, queue.length);
  if (slots.length < queue.length) return [];
  return queue.map((entry, index) => ({ id: entry.id, from: entry.at, to: slots[index] }));
}

/* ---------- approval ---------- */

interface HashableTranslation {
  locale: string;
  title: string;
  description: string;
  bodyMd: string;
  faq: unknown;
  sources: unknown;
}

interface HashableImage {
  slot: string;
  url: string | null;
  alt: unknown;
}

/**
 * Fingerprint of what the editor approved: the RU and EN texts (title, description, body, FAQ,
 * sources), the address and the images (slot, file, alt text). Any change invalidates the approval.
 */
export function approvalHash(post: { slug: string; translations: HashableTranslation[]; images?: HashableImage[] }): string {
  const texts = ["ru", "en"].map((locale) => {
    const t = post.translations.find((candidate) => candidate.locale === locale);
    return t ? [locale, t.title, t.description, t.bodyMd, t.faq, t.sources] : [locale, null];
  });
  const images = [...(post.images ?? [])]
    .sort((a, b) => a.slot.localeCompare(b.slot))
    .map((image) => [image.slot, image.url, image.alt]);
  return createHash("sha256").update(JSON.stringify([post.slug, texts, images])).digest("hex");
}

/** Short code carried by the buttons: the checked text and the warnings the editor saw. */
export function approvalFingerprint(hash: string, warnings: readonly string[]): string {
  return createHash("sha256")
    .update(`${hash}|${[...warnings].sort().join(",")}`)
    .digest("hex")
    .slice(0, 8);
}

/** Warnings shown at approval that were not there are new; the article then needs the editor again. */
export function newWarnings(approved: readonly string[], current: readonly string[]): string[] {
  return current.filter((id) => !approved.includes(id));
}

/* ---------- button and reply formats ---------- */

/** "202611211000" ↔ Cyprus local date and time. */
export function encodeStamp(slot: LocalSlot): string {
  return `${slot.date.replace(/-/g, "")}${slot.time.replace(":", "")}`;
}

export function decodeStamp(stamp: string): LocalSlot | null {
  const match = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(stamp);
  if (!match) return null;
  return { date: `${match[1]}-${match[2]}-${match[3]}`, time: `${match[4]}:${match[5]}` };
}

export function decodeDate(compact: string): string | null {
  const match = /^(\d{4})(\d{2})(\d{2})$/.exec(compact);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : null;
}

export type DateTimeInput = { ok: true; slot: LocalSlot } | { ok: false; reason: string };

/** The editor's typed date and time: "25.11 10:30" or "25.11.2026 10:30". */
export function parseDateTimeInput(text: string, now: Date): DateTimeInput {
  const match = /^(\d{1,2})\.(\d{1,2})(?:\.(\d{4}))?\s+(\d{1,2}[:.]\d{2})$/.exec(text.trim());
  if (!match) return { ok: false, reason: "Формат: ДД.ММ ЧЧ:ММ, например 25.11 10:30" };
  const time = normalizeTime(match[4]);
  if (!time) return { ok: false, reason: "Время в формате ЧЧ:ММ, например 10:30" };
  if (!isOnGrid(time)) return { ok: false, reason: "Минуты должны быть 00, 15, 30 или 45 — очередь проверяется раз в 15 минут" };
  const day = Number(match[1]);
  const month = Number(match[2]);
  const today = localSlotOf(now).date;
  const build = (year: number) => `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  const thisYear = Number(today.slice(0, 4));
  let date = build(match[3] ? Number(match[3]) : thisYear);
  // Without a year a date already passed means next year.
  if (!match[3] && date < today) date = build(thisYear + 1);
  const check = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(check.getTime()) || check.getUTCDate() !== day || check.getUTCMonth() + 1 !== month) {
    return { ok: false, reason: "Такой даты нет" };
  }
  return { ok: true, slot: { date, time } };
}

export type SlotProblem = "past" | "too_far" | "missing_hour" | null;

/** Why a chosen slot cannot be used, or null. */
export function slotProblem(slot: LocalSlot, now: Date): SlotProblem {
  const instant = slotInstant(slot);
  if (!instant) return "missing_hour";
  if (instant.getTime() < now.getTime() + MIN_LEAD_MS) return "past";
  if (instant.getTime() > now.getTime() + MAX_DAYS_AHEAD * 24 * 3600_000) return "too_far";
  return null;
}

export const SLOT_PROBLEM_TEXT: Record<Exclude<SlotProblem, null>, string> = {
  past: "Это время уже прошло или наступит меньше чем через 5 минут. Выберите другое.",
  too_far: `Можно планировать не дальше чем на ${MAX_DAYS_AHEAD} дней вперёд.`,
  missing_hour: "В этот день часы переводятся на летнее время, и такого времени нет. Выберите другое.",
};

/** Times offered by the date picker: the daily schedule plus every hour 08:00–21:00. */
export function pickerTimes(times: readonly string[]): string[] {
  const hourly = Array.from({ length: 14 }, (_, index) => `${String(8 + index).padStart(2, "0")}:00`);
  return [...new Set([...times, ...hourly])].sort();
}

/* ---------- Russian wording ---------- */

const dayMonth = new Intl.DateTimeFormat("ru-RU", { timeZone: SCHEDULE_TIME_ZONE, day: "numeric", month: "long" });
const weekdayShort = new Intl.DateTimeFormat("ru-RU", { timeZone: SCHEDULE_TIME_ZONE, weekday: "short" });
const weekdayLong = new Intl.DateTimeFormat("ru-RU", { timeZone: SCHEDULE_TIME_ZONE, weekday: "long" });
const numericDate = new Intl.DateTimeFormat("ru-RU", { timeZone: SCHEDULE_TIME_ZONE, day: "2-digit", month: "2-digit", year: "numeric" });
const shortDate = new Intl.DateTimeFormat("ru-RU", { timeZone: SCHEDULE_TIME_ZONE, day: "2-digit", month: "2-digit" });

/** "21 ноября, 10:00" */
export function formatSlot(instant: Date): string {
  return `${dayMonth.format(instant)}, ${localSlotOf(instant).time}`;
}

/** "21 ноября (сб), 10:00" */
export function formatSlotWithWeekday(instant: Date): string {
  return `${dayMonth.format(instant)} (${weekdayShort.format(instant)}), ${localSlotOf(instant).time}`;
}

/** "21 ноября, суббота" */
export function formatDayHeading(instant: Date): string {
  return `${dayMonth.format(instant)}, ${weekdayLong.format(instant)}`;
}

/** "21.11.2026" */
export function formatNumericDate(instant: Date): string {
  return numericDate.format(instant);
}

/** Button label for a day: "Сб 21.11". */
export function dayButtonLabel(date: string): string {
  const noon = slotInstant({ date, time: "12:00" }) ?? new Date(`${date}T10:00:00Z`);
  const weekday = weekdayShort.format(noon);
  return `${weekday.charAt(0).toUpperCase()}${weekday.slice(1)} ${shortDate.format(noon)}`;
}

/** Entries grouped by Cyprus date, in time order. */
export function groupByDay<T extends { at: Date }>(entries: T[]): { date: string; heading: string; items: T[] }[] {
  const groups: { date: string; heading: string; items: T[] }[] = [];
  for (const entry of [...entries].sort((a, b) => a.at.getTime() - b.at.getTime())) {
    const date = localSlotOf(entry.at).date;
    const last = groups.at(-1);
    if (last?.date === date) last.items.push(entry);
    else groups.push({ date, heading: formatDayHeading(entry.at), items: [entry] });
  }
  return groups;
}

export function pluralArticles(count: number): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return `${count} статья`;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return `${count} статьи`;
  return `${count} статей`;
}
