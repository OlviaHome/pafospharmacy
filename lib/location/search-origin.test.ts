import { describe, expect, it } from "vitest";

import {
  geolocationFallbackMessage,
  gpsSearchOrigin,
  manualSearchOrigin,
  type SearchOrigin,
} from "./search-origin";

describe("search origin", () => {
  it("represents GPS without assuming every origin is GPS", () => {
    expect(gpsSearchOrigin({ latitude: 34.77, longitude: 32.42 })).toEqual({
      source: "gps",
      label: "Your location",
      coordinates: { latitude: 34.77, longitude: 32.42 },
    });
  });

  it("represents a user-selected manual address and replaces a previous origin", () => {
    let origin: SearchOrigin | null = gpsSearchOrigin({
      latitude: 34.77,
      longitude: 32.42,
    });
    origin = manualSearchOrigin({
      label: "Chloraka, Hlorakas Community, Cyprus",
      coordinates: { latitude: 34.8, longitude: 32.41 },
      resultIdentifier: "chloraka",
    });
    expect(origin.source).toBe("manual");
    expect(origin.label).toContain("Chloraka");
  });

  it("supports clearing back to no-origin browse mode", () => {
    let origin: SearchOrigin | null = gpsSearchOrigin({
      latitude: 34.77,
      longitude: 32.42,
    });
    origin = null;
    expect(origin).toBeNull();
  });

  it("turns denied or unavailable GPS into an actionable manual fallback", () => {
    expect(geolocationFallbackMessage("denied")).toBe(
      "Couldn't access your location. Enter an area or address instead.",
    );
    expect(geolocationFallbackMessage("unavailable")).toBe(
      "Couldn't access your location. Enter an area or address instead.",
    );
    expect(geolocationFallbackMessage("idle")).toBeNull();
  });
});
