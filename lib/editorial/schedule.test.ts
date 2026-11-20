import { describe, expect, it } from "vitest";

import {
  approvalFingerprint,
  approvalHash,
  decodeStamp,
  defaultTimesFor,
  encodeStamp,
  formatSlot,
  groupByDay,
  localSlotOf,
  newWarnings,
  nextFreeSlots,
  parseDateTimeInput,
  parseTimes,
  planRedistribution,
  pluralArticles,
  slotInstant,
  slotProblem,
} from "./schedule";

const local = (instant: Date) => {
  const slot = localSlotOf(instant);
  return `${slot.date} ${slot.time}`;
};

describe("daily times", () => {
  it("accepts times on the 15-minute grid, sorted and without repeats", () => {
    expect(parseTimes("17:00, 10:00 10.00; 9:15")).toEqual({ ok: true, times: ["09:15", "10:00", "17:00"] });
  });

  it("refuses times off the grid, nonsense and too many", () => {
    expect(parseTimes("10:10").ok).toBe(false);
    expect(parseTimes("25:00").ok).toBe(false);
    expect(parseTimes("утром").ok).toBe(false);
    expect(parseTimes("").ok).toBe(false);
    expect(parseTimes("08:00 09:00 10:00 11:00 12:00 13:00 14:00").ok).toBe(false);
  });

  it("offers default times for each number per day, two by default", () => {
    expect(defaultTimesFor(2)).toEqual(["10:00", "17:00"]);
    for (let count = 1; count <= 6; count += 1) expect(defaultTimesFor(count)).toHaveLength(count);
  });
});

describe("queue slots", () => {
  const now = new Date("2026-11-20T13:40:00Z"); // 15:40 in Cyprus

  it("gives the next free slot and never a time that has passed", () => {
    const [first] = nextFreeSlots(["10:00", "17:00"], [], now);
    expect(local(first)).toBe("2026-11-20 17:00");
  });

  it("spreads 10 articles over five days at two a day", () => {
    const morning = new Date("2026-11-20T06:00:00Z"); // 08:00 in Cyprus
    const slots = nextFreeSlots(["10:00", "17:00"], [], morning, 10);
    expect(slots.map(local)).toEqual([
      "2026-11-20 10:00",
      "2026-11-20 17:00",
      "2026-11-21 10:00",
      "2026-11-21 17:00",
      "2026-11-22 10:00",
      "2026-11-22 17:00",
      "2026-11-23 10:00",
      "2026-11-23 17:00",
      "2026-11-24 10:00",
      "2026-11-24 17:00",
    ]);
    expect(new Set(slots.map((slot) => slot.getTime())).size).toBe(10);
  });

  it("skips slots that are already taken, including ones chosen by hand", () => {
    const taken = [slotInstant({ date: "2026-11-20", time: "17:00" })!.getTime(), slotInstant({ date: "2026-11-21", time: "10:00" })!.getTime()];
    const slots = nextFreeSlots(["10:00", "17:00"], taken, now, 2);
    expect(slots.map(local)).toEqual(["2026-11-21 17:00", "2026-11-22 10:00"]);
  });

  it("does not offer a slot starting in less than five minutes", () => {
    const almost = new Date("2026-11-20T14:57:00Z"); // 16:57 in Cyprus
    expect(local(nextFreeSlots(["17:00"], [], almost)[0])).toBe("2026-11-21 17:00");
  });
});

describe("summer and winter time in Cyprus", () => {
  it("keeps 10:00 local on both sides of the change; only the UTC instant moves", () => {
    // Summer time ends on 25 October 2026 and starts on 28 March 2027.
    expect(slotInstant({ date: "2026-10-24", time: "10:00" })!.toISOString()).toBe("2026-10-24T07:00:00.000Z");
    expect(slotInstant({ date: "2026-10-26", time: "10:00" })!.toISOString()).toBe("2026-10-26T08:00:00.000Z");
    expect(slotInstant({ date: "2027-03-27", time: "10:00" })!.toISOString()).toBe("2027-03-27T08:00:00.000Z");
    expect(slotInstant({ date: "2027-03-29", time: "10:00" })!.toISOString()).toBe("2027-03-29T07:00:00.000Z");
  });

  it("queues across the change at the same local hours", () => {
    const before = new Date("2027-03-26T12:00:00Z");
    const slots = nextFreeSlots(["10:00", "17:00"], [], before, 6);
    expect(slots.map(local)).toEqual([
      "2027-03-26 17:00",
      "2027-03-27 10:00",
      "2027-03-27 17:00",
      "2027-03-28 10:00",
      "2027-03-28 17:00",
      "2027-03-29 10:00",
    ]);
  });

  it("refuses the hour that does not exist when the clocks go forward", () => {
    expect(slotInstant({ date: "2027-03-28", time: "03:30" })).toBeNull();
    expect(slotProblem({ date: "2027-03-28", time: "03:30" }, new Date("2027-03-01T00:00:00Z"))).toBe("missing_hour");
  });
});

describe("redistribution", () => {
  it("moves only queue entries, in their order, and keeps times chosen by hand", () => {
    const now = new Date("2026-11-20T06:00:00Z");
    const at = (date: string, time: string) => slotInstant({ date, time })!;
    const moves = planRedistribution(
      [
        { id: "a", at: at("2026-11-20", "10:00"), mode: "queue" },
        { id: "m", at: at("2026-11-20", "12:00"), mode: "manual" },
        { id: "b", at: at("2026-11-20", "17:00"), mode: "queue" },
        { id: "c", at: at("2026-11-21", "10:00"), mode: "queue" },
      ],
      ["09:00", "12:00", "18:00"],
      now,
    );
    expect(moves.map((move) => [move.id, local(move.to)])).toEqual([
      ["a", "2026-11-20 09:00"],
      ["b", "2026-11-20 18:00"],
      ["c", "2026-11-21 09:00"],
    ]);
  });
});

describe("approval", () => {
  const post = () => ({
    slug: "gesy",
    translations: [
      { locale: "ru", title: "Что такое GeSY", description: "Описание", bodyMd: "Текст", faq: [], sources: [] },
      { locale: "en", title: "What is GeSY", description: "Description", bodyMd: "Text", faq: [], sources: [] },
      { locale: "el", title: "Τι είναι", description: "", bodyMd: "", faq: [], sources: [] },
    ],
  });

  it("changes when the RU or EN text changes, not when EL changes", () => {
    const base = approvalHash(post());
    const ru = post();
    ru.translations[0].bodyMd = "Текст изменён";
    const en = post();
    en.translations[1].title = "What is GeSY?";
    const el = post();
    el.translations[2].bodyMd = "Αλλαγή";
    expect(approvalHash(ru)).not.toBe(base);
    expect(approvalHash(en)).not.toBe(base);
    expect(approvalHash(el)).toBe(base);
  });

  it("changes when an image file or its alt text changes", () => {
    const withImage = (url: string, alt: string) => ({ ...post(), images: [{ slot: "cover", url, alt: { ru: alt } }] });
    const base = approvalHash(withImage("https://x/a.jpg", "аптека"));
    expect(approvalHash(withImage("https://x/b.jpg", "аптека"))).not.toBe(base);
    expect(approvalHash(withImage("https://x/a.jpg", "другая подпись"))).not.toBe(base);
    expect(approvalHash(withImage("https://x/a.jpg", "аптека"))).toBe(base);
  });

  it("binds the button code to the warnings the editor saw", () => {
    const hash = approvalHash(post());
    expect(approvalFingerprint(hash, ["links"])).not.toBe(approvalFingerprint(hash, []));
    expect(approvalFingerprint(hash, ["a", "b"])).toBe(approvalFingerprint(hash, ["b", "a"]));
    expect(approvalFingerprint(hash, [])).toHaveLength(8);
  });

  it("finds warnings that were not approved", () => {
    expect(newWarnings(["links"], ["links", "facts-normal"])).toEqual(["facts-normal"]);
    expect(newWarnings(["links", "x"], ["links"])).toEqual([]);
  });
});

describe("typed dates and button codes", () => {
  const now = new Date("2026-11-20T13:40:00Z");

  it("reads a date and time, with or without the year", () => {
    expect(parseDateTimeInput("25.11 10:30", now)).toEqual({ ok: true, slot: { date: "2026-11-25", time: "10:30" } });
    expect(parseDateTimeInput("3.1 9:00", now)).toEqual({ ok: true, slot: { date: "2027-01-03", time: "09:00" } });
    expect(parseDateTimeInput("01.12.2026 17:45", now)).toEqual({ ok: true, slot: { date: "2026-12-01", time: "17:45" } });
  });

  it("refuses impossible dates, times off the grid and nonsense", () => {
    expect(parseDateTimeInput("31.02 10:00", now).ok).toBe(false);
    expect(parseDateTimeInput("25.11 10:20", now).ok).toBe(false);
    expect(parseDateTimeInput("завтра", now).ok).toBe(false);
  });

  it("knows a past time and one too far ahead", () => {
    expect(slotProblem({ date: "2026-11-20", time: "15:00" }, now)).toBe("past");
    expect(slotProblem({ date: "2028-01-01", time: "10:00" }, now)).toBe("too_far");
    expect(slotProblem({ date: "2026-11-21", time: "10:00" }, now)).toBeNull();
  });

  it("encodes a slot for a button and back", () => {
    expect(encodeStamp({ date: "2026-11-21", time: "10:00" })).toBe("202611211000");
    expect(decodeStamp("202611211000")).toEqual({ date: "2026-11-21", time: "10:00" });
    expect(decodeStamp("2026")).toBeNull();
  });
});

describe("wording", () => {
  it("formats slots in Russian, Cyprus time", () => {
    expect(formatSlot(slotInstant({ date: "2026-11-21", time: "10:00" })!)).toBe("21 ноября, 10:00");
  });

  it("groups by Cyprus day in time order", () => {
    const at = (date: string, time: string) => slotInstant({ date, time })!;
    const groups = groupByDay([
      { at: at("2026-11-22", "10:00"), n: 3 },
      { at: at("2026-11-21", "17:00"), n: 2 },
      { at: at("2026-11-21", "10:00"), n: 1 },
    ]);
    expect(groups.map((group) => [group.date, group.items.map((item) => item.n)])).toEqual([
      ["2026-11-21", [1, 2]],
      ["2026-11-22", [3]],
    ]);
    expect(groups[0].heading).toBe("21 ноября, суббота");
  });

  it("declines «статья»", () => {
    expect([1, 2, 5, 11, 21, 22].map(pluralArticles)).toEqual(["1 статья", "2 статьи", "5 статей", "11 статей", "21 статья", "22 статьи"]);
  });
});
