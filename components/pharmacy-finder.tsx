"use client";

import {
  AlertTriangle,
  Clock3,
  LocateFixed,
  MapPin,
  Navigation,
  Phone,
  Plus,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import {
  deriveAvailability,
  filterPharmaciesByAvailability,
  intervalsForWindow,
  type AvailabilityFilter,
} from "@/lib/domain/availability";
import {
  formatCyprusDate,
  formatCyprusTime,
  getCyprusDayWindow,
} from "@/lib/domain/date";
import { haversineDistanceKm } from "@/lib/domain/distance";
import type {
  AvailabilityInterval,
  Coordinates,
  DataAttribution,
  Pharmacy,
  PharmacyDataSource,
} from "@/lib/domain/types";

type SelectedDay = "today" | "tomorrow";
type LocationState = "idle" | "locating" | "ready" | "denied" | "unavailable";

interface PharmacyFinderProps {
  pharmacies: Pharmacy[];
  source: PharmacyDataSource;
  generatedAt: string;
  ordinaryOpeningDataAvailable: boolean;
  attribution: DataAttribution | null;
}

interface PharmacyResult {
  pharmacy: Pharmacy;
  distanceKm: number | null;
}

const filters: Record<SelectedDay, { value: AvailabilityFilter; label: string }[]> = {
  today: [
    { value: "all", label: "All" },
    { value: "open_now", label: "Open Now" },
    { value: "on_duty", label: "On Duty" },
  ],
  tomorrow: [
    { value: "all", label: "All" },
    { value: "on_duty", label: "On Duty" },
  ],
};

function intervalLabel(interval: AvailabilityInterval): string {
  if (interval.scheduleKind === "ordinary") return "Ordinary · open";
  if (interval.serviceMode === "open") return "Duty · open";
  if (interval.serviceMode === "on_call") return "Duty · on call";
  return "Duty · service mode unconfirmed";
}

function intervalTime(interval: AvailabilityInterval): string {
  const startsOn = formatCyprusDate(interval.startsAt);
  const endsOn = formatCyprusDate(interval.endsAt);
  const end = `${endsOn === startsOn ? "" : `${endsOn} · `}${formatCyprusTime(interval.endsAt)}`;
  return `${startsOn} · ${formatCyprusTime(interval.startsAt)}–${end}`;
}

function formatCoverageDate(value: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Europe/Nicosia",
  }).format(new Date(`${value}T12:00:00.000Z`));
}

function StatusBadges({
  pharmacy,
  now,
  ordinaryOpeningDataAvailable,
}: {
  pharmacy: Pharmacy;
  now: Date;
  ordinaryOpeningDataAvailable: boolean;
}) {
  const availability = deriveAvailability(pharmacy.intervals, now, {
    dutyAssignments: pharmacy.dutyAssignments,
    ordinaryOpeningCoverageKnown: ordinaryOpeningDataAvailable,
  });

  if (
    availability.activeIntervals.length === 0 &&
    availability.activeDutyAssignments.length === 0
  ) {
    return (
      <span className="rounded-full bg-[var(--surface-muted)] px-3 py-1.5 text-[0.68rem] font-extrabold tracking-[0.08em] text-[var(--ink-muted)]">
        NO ACTIVE SCHEDULE INFORMATION
      </span>
    );
  }

  return (
    <>
      {availability.openNow === true && (
        <span className="rounded-full bg-[var(--brand-soft)] px-3 py-1.5 text-[0.68rem] font-extrabold tracking-[0.08em] text-[var(--brand-strong)]">
          OPEN NOW
        </span>
      )}
      {availability.onDuty && (
        <span className="rounded-full bg-[#e8eef9] px-3 py-1.5 text-[0.68rem] font-extrabold tracking-[0.08em] text-[#304f83]">
          ON DUTY
        </span>
      )}
      {availability.onCall === true && (
        <span className="rounded-full bg-[var(--amber-soft)] px-3 py-1.5 text-[0.68rem] font-extrabold tracking-[0.08em] text-[var(--amber)]">
          ON CALL — CALL FIRST
        </span>
      )}
      {availability.activeDutyAssignments.length > 0 &&
        availability.activeIntervals.filter((interval) => interval.scheduleKind === "duty")
          .length === 0 && (
        <span className="rounded-full bg-[var(--amber-soft)] px-3 py-1.5 text-[0.68rem] font-extrabold tracking-[0.08em] text-[var(--amber)]">
          HOURS NOT PUBLISHED — CALL FIRST
        </span>
      )}
    </>
  );
}

function PharmacyCard({
  result,
  selectedDay,
  now,
  ordinaryOpeningDataAvailable,
}: {
  result: PharmacyResult;
  selectedDay: SelectedDay;
  now: Date;
  ordinaryOpeningDataAvailable: boolean;
}) {
  const { pharmacy, distanceKm } = result;
  const dayWindow = useMemo(
    () => getCyprusDayWindow(now, selectedDay === "tomorrow" ? 1 : 0),
    [now, selectedDay],
  );
  const relevantIntervals = intervalsForWindow(pharmacy.intervals, dayWindow);
  const relevantDutyAssignments = pharmacy.dutyAssignments.filter(
    (assignment) => assignment.dutyDate === dayWindow.localDate,
  );
  const availability = deriveAvailability(pharmacy.intervals, now, {
    dutyAssignments: pharmacy.dutyAssignments,
    ordinaryOpeningCoverageKnown: ordinaryOpeningDataAvailable,
  });
  const address = `${pharmacy.addressLine}${pharmacy.addressAdditional ? `, ${pharmacy.addressAdditional}` : ""}, ${pharmacy.locality}${pharmacy.postalCode ? ` ${pharmacy.postalCode}` : ""}`;
  const directionsQuery =
    pharmacy.latitude !== null && pharmacy.longitude !== null
      ? `${pharmacy.latitude},${pharmacy.longitude}`
      : address;
  const directions = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(directionsQuery)}`;

  return (
    <article className="rounded-[1.5rem] border border-[var(--line)] bg-[var(--surface)] p-5 shadow-[var(--shadow)]">
      {selectedDay === "today" && (
        <div className="mb-3 flex flex-wrap gap-2">
          <StatusBadges
            pharmacy={pharmacy}
            now={now}
            ordinaryOpeningDataAvailable={ordinaryOpeningDataAvailable}
          />
        </div>
      )}

      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h3 className="text-lg font-extrabold tracking-[-0.02em] text-[var(--ink)]">
            {pharmacy.name}
          </h3>
          <p className="mt-1.5 flex items-start gap-2 text-sm leading-5 text-[var(--ink-muted)]">
            <MapPin className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <span>{address}</span>
          </p>
        </div>
        {distanceKm !== null && (
          <span className="shrink-0 rounded-xl bg-[var(--surface-muted)] px-2.5 py-1.5 text-sm font-bold text-[var(--brand-strong)]">
            ≈ {distanceKm < 10 ? distanceKm.toFixed(1) : Math.round(distanceKm)} km
          </span>
        )}
      </div>

      {availability.hasConflict && selectedDay === "today" && (
        <div className="mt-4 flex gap-2 rounded-2xl border border-[#edc983] bg-[var(--amber-soft)] p-3 text-sm leading-5 text-[#68420b]">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <p>
            <strong>SCHEDULE CONFLICT — CALL TO CONFIRM.</strong> Ordinary hours say open while the duty record says on call; neither fact has been discarded.
          </p>
        </div>
      )}

      <div className="mt-4 border-t border-[var(--line)] pt-4">
        <div className="mb-2 flex items-center gap-2 text-xs font-extrabold uppercase tracking-[0.12em] text-[var(--ink-muted)]">
          <Clock3 className="size-4" aria-hidden="true" />
          {selectedDay === "today" ? "Today's recorded periods" : "Tomorrow's recorded periods"}
        </div>
        {relevantIntervals.length > 0 || relevantDutyAssignments.length > 0 ? (
          <ul className="space-y-2">
            {relevantIntervals.map((interval) => (
              <li key={interval.id} className="flex items-start justify-between gap-3 text-sm leading-5">
                <span className="font-semibold text-[var(--ink)]">{intervalLabel(interval)}</span>
                <span className="text-right text-[var(--ink-muted)]">{intervalTime(interval)}</span>
              </li>
            ))}
            {relevantDutyAssignments.map((assignment) => (
              <li key={assignment.id} className="flex items-start justify-between gap-3 text-sm leading-5">
                <span className="font-semibold text-[var(--ink)]">Official duty assignment</span>
                <span className="text-right text-[var(--ink-muted)]">
                  Date only · call for exact hours
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm leading-5 text-[var(--ink-muted)]">
            No schedule information is recorded for this day.
          </p>
        )}
      </div>

      <div className="mt-5 grid grid-cols-2 gap-3">
        {pharmacy.phoneE164 ? (
          <a
            className="flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-[var(--brand)] px-4 text-sm font-extrabold text-white transition-colors hover:bg-[var(--brand-strong)]"
            href={`tel:${pharmacy.phoneE164}`}
          >
            <Phone className="size-4" aria-hidden="true" />
            Call
          </a>
        ) : (
          <span className="flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-[var(--surface-muted)] px-4 text-sm font-extrabold text-[var(--ink-muted)]">
            <Phone className="size-4" aria-hidden="true" />
            Phone unavailable
          </span>
        )}
        <a
          className="flex min-h-12 items-center justify-center gap-2 rounded-2xl border border-[var(--line-strong)] bg-white px-4 text-sm font-extrabold text-[var(--brand-strong)] transition-colors hover:bg-[var(--surface-muted)]"
          href={directions}
          target="_blank"
          rel="noreferrer"
        >
          <Navigation className="size-4" aria-hidden="true" />
          Directions
        </a>
      </div>
    </article>
  );
}

export function PharmacyFinder({
  pharmacies,
  source,
  generatedAt,
  ordinaryOpeningDataAvailable,
  attribution,
}: PharmacyFinderProps) {
  const [selectedDay, setSelectedDay] = useState<SelectedDay>("today");
  const [filter, setFilter] = useState<AvailabilityFilter>("all");
  const [now, setNow] = useState(() => new Date(generatedAt));
  const [coordinates, setCoordinates] = useState<Coordinates | null>(null);
  const [locationState, setLocationState] = useState<LocationState>("idle");

  useEffect(() => {
    const initialLocalDate = getCyprusDayWindow(new Date(generatedAt)).localDate;
    const timer = window.setInterval(() => {
      const current = new Date();
      if (getCyprusDayWindow(current).localDate !== initialLocalDate) {
        window.location.reload();
        return;
      }
      setNow(current);
    }, 30_000);
    return () => window.clearInterval(timer);
  }, [generatedAt]);

  const dayWindow = useMemo(
    () => getCyprusDayWindow(now, selectedDay === "tomorrow" ? 1 : 0),
    [now, selectedDay],
  );
  const results = useMemo(() => {
    const matching = filterPharmaciesByAvailability(
      pharmacies,
      filter,
      dayWindow,
      now,
      ordinaryOpeningDataAvailable,
    );
    return matching
      .map((pharmacy) => ({
        pharmacy,
        distanceKm:
          coordinates && pharmacy.latitude !== null && pharmacy.longitude !== null
          ? haversineDistanceKm(coordinates, {
              latitude: pharmacy.latitude,
              longitude: pharmacy.longitude,
            })
          : null,
      }))
      .sort((left, right) => {
        if (left.distanceKm !== null && right.distanceKm !== null) {
          return left.distanceKm - right.distanceKm;
        }
        const leftAvailability = deriveAvailability(left.pharmacy.intervals, now, {
          dutyAssignments: left.pharmacy.dutyAssignments,
          ordinaryOpeningCoverageKnown: ordinaryOpeningDataAvailable,
        });
        const rightAvailability = deriveAvailability(right.pharmacy.intervals, now, {
          dutyAssignments: right.pharmacy.dutyAssignments,
          ordinaryOpeningCoverageKnown: ordinaryOpeningDataAvailable,
        });
        const score = (value: ReturnType<typeof deriveAvailability>) =>
          (value.openNow === true ? 2 : 0) + (value.onDuty ? 1 : 0);
        return score(rightAvailability) - score(leftAvailability);
      });
  }, [coordinates, dayWindow, filter, now, ordinaryOpeningDataAvailable, pharmacies]);

  function chooseDay(day: SelectedDay) {
    setSelectedDay(day);
    if (day === "tomorrow" && filter === "open_now") setFilter("all");
  }

  function requestLocation() {
    if (!("geolocation" in navigator)) {
      setLocationState("unavailable");
      return;
    }

    setLocationState("locating");
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setCoordinates({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        });
        setLocationState("ready");
      },
      (error) => {
        setCoordinates(null);
        setLocationState(error.code === error.PERMISSION_DENIED ? "denied" : "unavailable");
      },
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 300_000 },
    );
  }

  const locationMessage =
    locationState === "denied"
      ? "Location permission was declined. Results still work without distance sorting."
      : locationState === "unavailable"
        ? "Location is unavailable. Results still work without distance sorting."
        : locationState === "ready"
          ? "Showing approximate straight-line distance, nearest first."
          : null;

  return (
    <main className="mx-auto min-h-screen w-full max-w-3xl px-4 py-5 sm:px-6 sm:py-8">
      <header className="mb-5 flex items-center gap-3">
        <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-[var(--brand)] text-white shadow-sm">
          <Plus className="size-7 stroke-[3]" aria-hidden="true" />
        </span>
        <div>
          <h1 className="text-xl font-extrabold tracking-[-0.025em] text-[var(--ink)]">
            Paphos Pharmacy
          </h1>
          <p className="text-sm text-[var(--ink-muted)]">Official directory and duty rota for Paphos.</p>
        </div>
      </header>

      {source === "fixtures" && (
        <aside className="mb-4 rounded-2xl border border-[#ead8ae] bg-[var(--amber-soft)] px-4 py-3 text-sm leading-5 text-[#68420b]">
          <strong>Development data only.</strong> Pharmacy details, opening hours, and duty status are synthetic and must not be treated as official or current information.
        </aside>
      )}

      {attribution && (
        <aside className="mb-4 rounded-2xl border border-[#cbd8ed] bg-[#f0f5fc] px-4 py-3 text-sm leading-5 text-[#304f83]">
          Pharmacy identities and date-only duty assignments come from the{" "}
          <a
            className="font-bold underline"
            href={attribution.datasetPage}
            target="_blank"
            rel="noreferrer"
          >
            {attribution.organization} open-data release
          </a>{" "}
          (<a className="underline" href={attribution.licenseUrl} target="_blank" rel="noreferrer">
            {attribution.license}
          </a>). Duty coverage is {formatCoverageDate(attribution.dutyCoverageStart)}–
          {formatCoverageDate(attribution.dutyCoverageEnd)}; snapshot retrieved{" "}
          {formatCoverageDate(attribution.retrievedAt.slice(0, 10))}. It does not publish ordinary opening hours or exact duty hours; call before travelling.
        </aside>
      )}

      <section aria-label="Search controls" className="mb-5 rounded-3xl border border-[var(--line)] bg-[var(--surface)] p-4 shadow-[var(--shadow)]">
        <div className="grid grid-cols-2 gap-2 rounded-2xl bg-[var(--surface-muted)] p-1">
          {(["today", "tomorrow"] as const).map((day) => (
            <button
              key={day}
              type="button"
              aria-pressed={selectedDay === day}
              onClick={() => chooseDay(day)}
              className={`min-h-11 rounded-xl px-4 text-sm font-bold transition-colors ${
                selectedDay === day
                  ? "bg-white text-[var(--brand-strong)] shadow-sm"
                  : "text-[var(--ink-muted)] hover:text-[var(--ink)]"
              }`}
            >
              {day === "today" ? "Today" : "Tomorrow"}
            </button>
          ))}
        </div>

        <div className="mt-3 flex gap-2 overflow-x-auto pb-1" aria-label="Availability filter">
          {filters[selectedDay]
            .filter((option) => option.value !== "open_now" || ordinaryOpeningDataAvailable)
            .map((option) => (
              <button
                key={option.value}
                type="button"
                aria-pressed={filter === option.value}
                onClick={() => setFilter(option.value)}
                className={`min-h-10 shrink-0 rounded-full border px-4 text-sm font-bold transition-colors ${
                  filter === option.value
                    ? "border-[var(--brand)] bg-[var(--brand-soft)] text-[var(--brand-strong)]"
                    : "border-[var(--line)] bg-white text-[var(--ink-muted)] hover:border-[var(--line-strong)]"
                }`}
              >
                {option.label}
              </button>
            ))}
        </div>

        <button
          type="button"
          onClick={requestLocation}
          disabled={locationState === "locating"}
          className="mt-3 flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl bg-[var(--brand)] px-5 text-sm font-extrabold text-white transition-colors hover:bg-[var(--brand-strong)] disabled:cursor-wait disabled:opacity-70"
        >
          <LocateFixed className="size-5" aria-hidden="true" />
          {locationState === "locating"
            ? "Finding your location…"
            : locationState === "ready"
              ? "Update my location"
              : "Use my location"}
        </button>
        <p aria-live="polite" className="mt-2 min-h-5 text-xs leading-5 text-[var(--ink-muted)]">
          {locationMessage ?? "Location is optional and requested only when you tap the button."}
        </p>
      </section>

      <section aria-labelledby="results-heading">
        <div className="mb-3 flex items-end justify-between gap-4">
          <div>
            <p className="text-xs font-extrabold uppercase tracking-[0.16em] text-[var(--brand)]">
              {selectedDay === "today" ? "Available today" : "Schedule for tomorrow"}
            </p>
            <h2 id="results-heading" className="mt-1 text-lg font-extrabold tracking-[-0.015em]">
              Pharmacy results
            </h2>
          </div>
          <span className="shrink-0 text-sm font-semibold text-[var(--ink-muted)]">
            {results.length} {results.length === 1 ? "result" : "results"}
          </span>
        </div>

        {results.length > 0 ? (
          <div className="space-y-4">
            {results.map((result) => (
              <PharmacyCard
                key={result.pharmacy.id}
                result={result}
                selectedDay={selectedDay}
                now={now}
                ordinaryOpeningDataAvailable={ordinaryOpeningDataAvailable}
              />
            ))}
          </div>
        ) : (
          <div className="rounded-3xl border border-dashed border-[var(--line-strong)] bg-[var(--surface)] px-5 py-10 text-center">
            <h3 className="font-extrabold text-[var(--ink)]">No pharmacies match this filter</h3>
            <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-[var(--ink-muted)]">
              Try All to see every pharmacy with its recorded periods and contact actions.
            </p>
            <button
              type="button"
              onClick={() => setFilter("all")}
              className="mt-4 min-h-11 rounded-2xl border border-[var(--line-strong)] px-5 text-sm font-bold text-[var(--brand-strong)]"
            >
              Show all
            </button>
          </div>
        )}
      </section>

      <footer className="py-7 text-center text-xs leading-5 text-[var(--ink-muted)]">
        Dates use Europe/Nicosia. “On Duty” means an official date assignment; it does not prove the pharmacy is open or on call at the current instant.
      </footer>
    </main>
  );
}
