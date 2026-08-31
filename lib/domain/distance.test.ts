import { describe, expect, it } from "vitest";

import { haversineDistanceKm } from "./distance";

describe("haversineDistanceKm", () => {
  it("returns zero for the same point", () => {
    const point = { latitude: 34.772, longitude: 32.4297 };
    expect(haversineDistanceKm(point, point)).toBe(0);
  });

  it("calculates a plausible straight-line Paphos-to-Nicosia distance", () => {
    const distance = haversineDistanceKm(
      { latitude: 34.772, longitude: 32.4297 },
      { latitude: 35.1856, longitude: 33.3823 },
    );

    expect(distance).toBeGreaterThan(95);
    expect(distance).toBeLessThan(100);
  });
});
