import { describe, expect, it } from "vitest";

import { getCyprusDayWindow } from "./date";

describe("getCyprusDayWindow", () => {
  it("uses the Cyprus calendar day instead of the computer time zone", () => {
    const reference = new Date("2026-12-31T23:30:00.000Z");

    expect(getCyprusDayWindow(reference)).toEqual({
      start: "2026-12-31T22:00:00.000Z",
      end: "2027-01-01T22:00:00.000Z",
      localDate: "2027-01-01",
    });
    expect(getCyprusDayWindow(reference, 1).localDate).toBe("2027-01-02");
  });

  it("returns a 23-hour day across Cyprus spring daylight saving", () => {
    const reference = new Date("2026-03-28T22:30:00.000Z");
    const window = getCyprusDayWindow(reference);

    expect(window.localDate).toBe("2026-03-29");
    expect(window.start).toBe("2026-03-28T22:00:00.000Z");
    expect(window.end).toBe("2026-03-29T21:00:00.000Z");
    expect(new Date(window.end).getTime() - new Date(window.start).getTime()).toBe(
      23 * 60 * 60 * 1000,
    );
  });
});
