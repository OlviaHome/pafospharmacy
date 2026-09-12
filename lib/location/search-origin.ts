import type { Coordinates } from "../domain/types";

export type SearchOrigin =
  | {
      source: "gps";
      label: string;
      coordinates: Coordinates;
    }
  | {
      source: "manual";
      label: string;
      coordinates: Coordinates;
      provider: "geoapify";
      resultIdentifier: string;
    };

export type GeolocationStatus =
  | "idle"
  | "locating"
  | "ready"
  | "denied"
  | "unavailable";

export function gpsSearchOrigin(
  coordinates: Coordinates,
  label: string = "Your location",
): SearchOrigin {
  return { source: "gps", label, coordinates };
}

export function manualSearchOrigin(value: {
  label: string;
  coordinates: Coordinates;
  resultIdentifier: string;
}): SearchOrigin {
  return {
    source: "manual",
    label: value.label,
    coordinates: value.coordinates,
    provider: "geoapify",
    resultIdentifier: value.resultIdentifier,
  };
}

export function geolocationFallbackMessage(
  status: GeolocationStatus,
): string | null {
  if (status === "denied" || status === "unavailable") {
    return "Couldn't access your location. Enter an area or address instead.";
  }
  if (status === "locating") return "Finding your location…";
  return null;
}
