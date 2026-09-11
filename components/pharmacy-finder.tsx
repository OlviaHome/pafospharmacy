"use client";

import {
  AlertTriangle,
  ChevronDown,
  Clock3,
  LocateFixed,
  MapPin,
  Navigation,
  Phone,
  Plus,
  Search,
  X,
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
import {
  CYPRUS_DUTY_RULE_SOURCE_URL,
  deriveOfficialDutyStatus,
  officialDutyRuleAppliesAtInstant,
  officialDutyScheduleForDate,
} from "@/lib/domain/duty-hours";
import { haversineDistanceKm } from "@/lib/domain/distance";
import {
  formatDistance,
  sortPharmacyResults,
  visiblePharmacyResults,
  type PharmacyResult,
} from "@/lib/domain/results";
import type {
  AvailabilityInterval,
  Coordinates,
  CoordinateAttribution,
  DataAttribution,
  Pharmacy,
  PharmacyDataSource,
} from "@/lib/domain/types";
import type { ManualLocationSuggestion } from "@/lib/geocoding/geoapify";
import {
  geolocationFallbackMessage,
  gpsSearchOrigin,
  manualSearchOrigin,
  type GeolocationStatus,
  type SearchOrigin,
} from "@/lib/location/search-origin";
import {
  MINIMUM_MANUAL_QUERY_CHARACTERS,
  SessionManualLocationLookup,
  isManualSearchCancellation,
  normalizeManualLocationQuery,
} from "@/lib/location/manual-search";

type SelectedDay = "today" | "tomorrow";
type ManualSearchStatus = "idle" | "searching" | "error";

interface PharmacyFinderProps {
  pharmacies: Pharmacy[];
  source: PharmacyDataSource;
  generatedAt: string;
  ordinaryOpeningDataAvailable: boolean;
  attribution: DataAttribution | null;
  coordinateAttributions: CoordinateAttribution[];
}

const filters: Record<SelectedDay, { value: AvailabilityFilter; label: string }[]> = {
  today: [
    { value: "all", label: "All" },
    { value: "open_now", label: "Confirmed Open" },
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
  const officialDuty = deriveOfficialDutyStatus(pharmacy.dutyAssignments, now);

  if (
    availability.activeIntervals.length === 0 &&
    availability.activeDutyAssignments.length === 0 &&
    officialDuty.mode === "inactive"
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
      {officialDuty.onDutyToday && (
        <span className="rounded-full bg-[#e8eef9] px-3 py-1.5 text-[0.68rem] font-extrabold tracking-[0.08em] text-[#304f83]">
          ON DUTY TODAY
        </span>
      )}
      {availability.onDuty &&
        !officialDuty.onDutyToday &&
        officialDuty.mode !== "on_call" && (
          <span className="rounded-full bg-[#e8eef9] px-3 py-1.5 text-[0.68rem] font-extrabold tracking-[0.08em] text-[#304f83]">
            ON DUTY
          </span>
        )}
      {availability.onCall === true && (
        <span className="rounded-full bg-[var(--amber-soft)] px-3 py-1.5 text-[0.68rem] font-extrabold tracking-[0.08em] text-[var(--amber)]">
          ON DUTY — CALL PHARMACIST
        </span>
      )}
      {officialDuty.mode === "unknown" && (
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
  const relevantOfficialDutySchedules = relevantDutyAssignments.map((assignment) => ({
    assignment,
    schedule: officialDutyScheduleForDate(assignment.dutyDate),
  }));
  const availability = deriveAvailability(pharmacy.intervals, now, {
    dutyAssignments: pharmacy.dutyAssignments,
    ordinaryOpeningCoverageKnown: ordinaryOpeningDataAvailable,
  });
  const officialDuty = deriveOfficialDutyStatus(pharmacy.dutyAssignments, now);
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
            ≈ {formatDistance(distanceKm)}
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

      {selectedDay === "today" && officialDuty.mode === "open" && officialDuty.activePeriod && (
        <div className="mt-4 rounded-2xl border border-[#b9dfcf] bg-[var(--brand-soft)] p-3 text-sm leading-5 text-[var(--brand-strong)]">
          <strong>
            Duty pharmacy — open until {formatCyprusTime(officialDuty.activePeriod.endsAt)}
          </strong>
        </div>
      )}

      {selectedDay === "today" && officialDuty.mode === "scheduled_gap" && (
        <div className="mt-4 rounded-2xl border border-[#cbd8ed] bg-[#f0f5fc] p-3 text-sm leading-5 text-[#304f83]">
          <strong>On duty today.</strong>{" "}
          {officialDuty.nextOpenAt
            ? `Mandatory duty opening starts at ${formatCyprusTime(officialDuty.nextOpenAt)}.`
            : "The premises are not in a mandatory duty-open interval now."}
        </div>
      )}

      {selectedDay === "today" && officialDuty.mode === "on_call" && (
        <div className="mt-4 rounded-2xl border border-[#edc983] bg-[var(--amber-soft)] p-3 text-sm leading-5 text-[#68420b]">
          <strong>ON DUTY — CALL PHARMACIST</strong>
          <p>23:00–08:00: pharmacist available by phone for prescriptions</p>
        </div>
      )}

      <div className="mt-4 border-t border-[var(--line)] pt-4">
        <div className="mb-2 flex items-center gap-2 text-xs font-extrabold uppercase tracking-[0.12em] text-[var(--ink-muted)]">
          <Clock3 className="size-4" aria-hidden="true" />
          {selectedDay === "today" ? "Today's schedule information" : "Tomorrow's schedule information"}
        </div>
        {relevantIntervals.length > 0 || relevantDutyAssignments.length > 0 ? (
          <ul className="space-y-2">
            {relevantIntervals.map((interval) => (
              <li key={interval.id} className="flex items-start justify-between gap-3 text-sm leading-5">
                <span className="font-semibold text-[var(--ink)]">{intervalLabel(interval)}</span>
                <span className="text-right text-[var(--ink-muted)]">{intervalTime(interval)}</span>
              </li>
            ))}
            {relevantOfficialDutySchedules.flatMap(({ assignment, schedule }) =>
              schedule
                ? [
                    ...schedule.openPeriods.map((dutyPeriod, index) => (
                      <li
                        key={`${assignment.id}-open-${index}`}
                        className="flex items-start justify-between gap-3 text-sm leading-5"
                      >
                        <span className="font-semibold text-[var(--ink)]">
                          Official duty · open
                        </span>
                        <span className="text-right text-[var(--ink-muted)]">
                          {formatCyprusTime(dutyPeriod.startsAt)}–
                          {formatCyprusTime(dutyPeriod.endsAt)}
                        </span>
                      </li>
                    )),
                    <li
                      key={`${assignment.id}-on-call`}
                      className="flex items-start justify-between gap-3 text-sm leading-5"
                    >
                      <span className="font-semibold text-[var(--ink)]">
                        After 23:00 · call for prescriptions
                      </span>
                      <span className="text-right text-[var(--ink-muted)]">
                        23:00–08:00 next day
                      </span>
                    </li>,
                  ]
                : [
                    <li
                      key={assignment.id}
                      className="flex items-start justify-between gap-3 text-sm leading-5"
                    >
                      <span className="font-semibold text-[var(--ink)]">
                        Official duty assignment
                      </span>
                      <span className="text-right text-[var(--ink-muted)]">
                        Hours unavailable
                      </span>
                    </li>,
                  ],
            )}
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
  coordinateAttributions,
}: PharmacyFinderProps) {
  const [selectedDay, setSelectedDay] = useState<SelectedDay>("today");
  const [filter, setFilter] = useState<AvailabilityFilter>("all");
  const [now, setNow] = useState(() => new Date(generatedAt));
  const [searchOrigin, setSearchOrigin] = useState<SearchOrigin | null>(null);
  const [geolocationStatus, setGeolocationStatus] =
    useState<GeolocationStatus>("idle");
  const [manualSearchOpen, setManualSearchOpen] = useState(false);
  const [manualQuery, setManualQuery] = useState("");
  const [manualSearchStatus, setManualSearchStatus] =
    useState<ManualSearchStatus>("idle");
  const [manualSearchError, setManualSearchError] = useState<string | null>(null);
  const [manualSuggestions, setManualSuggestions] = useState<
    ManualLocationSuggestion[]
  >([]);
  const [manualLocationLookup] = useState(
    () => new SessionManualLocationLookup<ManualLocationSuggestion[]>(),
  );
  const [resultsExpanded, setResultsExpanded] = useState(false);
  const coordinates: Coordinates | null = searchOrigin?.coordinates ?? null;
  const openNowFilterAvailable =
    ordinaryOpeningDataAvailable || officialDutyRuleAppliesAtInstant(now);

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

  useEffect(
    () => () => manualLocationLookup.cancel(),
    [manualLocationLookup],
  );

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
    const distanceResults = matching.map((pharmacy) => ({
      pharmacy,
      distanceKm:
        coordinates && pharmacy.latitude !== null && pharmacy.longitude !== null
          ? haversineDistanceKm(coordinates, {
              latitude: pharmacy.latitude,
              longitude: pharmacy.longitude,
            })
          : null,
    }));
    return sortPharmacyResults(distanceResults, (left, right) => {
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
  const visibleResults = useMemo(
    () =>
      visiblePharmacyResults(results, {
        filter,
        locationKnown: searchOrigin !== null,
        expanded: resultsExpanded,
      }),
    [filter, results, resultsExpanded, searchOrigin],
  );

  function chooseDay(day: SelectedDay) {
    setSelectedDay(day);
    setResultsExpanded(false);
    if (day === "tomorrow" && filter === "open_now") setFilter("all");
  }

  function chooseFilter(nextFilter: AvailabilityFilter) {
    setFilter(nextFilter);
    setResultsExpanded(false);
  }

  function requestLocation() {
    if (!("geolocation" in navigator)) {
      setGeolocationStatus("unavailable");
      setManualSearchOpen(true);
      return;
    }

    setGeolocationStatus("locating");
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setSearchOrigin(
          gpsSearchOrigin({
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
          }),
        );
        setGeolocationStatus("ready");
        setResultsExpanded(false);
      },
      (error) => {
        setGeolocationStatus(
          error.code === error.PERMISSION_DENIED ? "denied" : "unavailable",
        );
        setManualSearchOpen(true);
      },
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 300_000 },
    );
  }

  function searchManualLocation(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const query = manualQuery.trim();
    if (
      normalizeManualLocationQuery(query).length <
      MINIMUM_MANUAL_QUERY_CHARACTERS
    ) {
      setManualSearchStatus("error");
      setManualSearchError("Enter at least 3 characters for an area or address.");
      return;
    }

    setManualSearchStatus("searching");
    setManualSearchError(null);
    setManualSuggestions([]);
    void manualLocationLookup
      .lookup(query, async (signal) => {
        const response = await fetch("/api/location-search", {
          method: "POST",
          cache: "no-store",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query }),
          signal,
        });
        const body = (await response.json()) as {
          suggestions?: ManualLocationSuggestion[];
          error?: string;
        };
        if (!response.ok) {
          throw new Error(body.error ?? "Location search failed.");
        }
        return body.suggestions ?? [];
      })
      .then((suggestions) => {
        if (suggestions.length > 0) {
          setManualSuggestions(suggestions);
          setManualSearchStatus("idle");
          return;
        }
        setManualSearchStatus("error");
        setManualSearchError(
          "No matching Paphos location was found. Try a nearby area or fuller address.",
        );
      })
      .catch((error: unknown) => {
        if (isManualSearchCancellation(error)) return;
        setManualSearchStatus("error");
        setManualSearchError(
          error instanceof Error
            ? error.message
            : "Location search is temporarily unavailable.",
        );
      });
  }

  function changeManualQuery(value: string) {
    manualLocationLookup.cancel();
    setManualQuery(value);
    setManualSuggestions([]);
    setManualSearchError(null);
    setManualSearchStatus("idle");
  }

  function chooseManualLocation(suggestion: ManualLocationSuggestion) {
    setSearchOrigin(
      manualSearchOrigin({
        label: suggestion.label,
        coordinates: {
          latitude: suggestion.latitude,
          longitude: suggestion.longitude,
        },
        resultIdentifier: suggestion.resultIdentifier,
      }),
    );
    setGeolocationStatus("idle");
    setManualSuggestions([]);
    setManualSearchError(null);
    setManualSearchStatus("idle");
    setManualSearchOpen(false);
    setResultsExpanded(false);
  }

  function clearSearchOrigin() {
    setSearchOrigin(null);
    if (geolocationStatus === "ready") setGeolocationStatus("idle");
    setResultsExpanded(false);
  }

  const gpsUnavailable =
    geolocationStatus === "denied" || geolocationStatus === "unavailable";
  const locationMessage = geolocationFallbackMessage(geolocationStatus);

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
          {formatCoverageDate(attribution.retrievedAt.slice(0, 10))}. Ordinary opening
          hours are separate. Mandatory duty hours come from the{" "}
          <a
            className="font-bold underline"
            href={CYPRUS_DUTY_RULE_SOURCE_URL}
            target="_blank"
            rel="noreferrer"
          >
            Cyprus Pharmaceutical Services 2026 duty notice
          </a>.
        </aside>
      )}

      {coordinateAttributions.length > 0 && (
        <aside className="mb-4 rounded-2xl border border-[#d6ddd8] bg-[#f5f8f6] px-4 py-3 text-sm leading-5 text-[#405149]">
          Coordinates, where available, are separate address enrichment. Providers:{" "}
          {coordinateAttributions.map((item, index) => (
            <span key={item.providerId}>
              {index > 0 ? "; " : ""}
              <a
                className="font-bold underline"
                href={item.attributionUrl}
                target="_blank"
                rel="noreferrer"
              >
                {item.attribution}
              </a>{" "}
              via {item.provider}
            </span>
          ))}
          . Official addresses remain unchanged.
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
            .filter((option) => option.value !== "open_now" || openNowFilterAvailable)
            .map((option) => (
              <button
                key={option.value}
                type="button"
                aria-pressed={filter === option.value}
                onClick={() => chooseFilter(option.value)}
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

        {!ordinaryOpeningDataAvailable && openNowFilterAvailable && (
          <p className="mt-2 text-xs leading-5 text-[var(--ink-muted)]">
            Confirmed Open currently includes pharmacies confirmed open by the official
            duty schedule. Regular pharmacy opening hours are not yet available.
          </p>
        )}

        <div className="mt-4 border-t border-[var(--line)] pt-4">
          <h2 className="text-base font-extrabold text-[var(--ink)]">
            Find pharmacies near you
          </h2>
          <p className="mt-1 text-sm leading-5 text-[var(--ink-muted)]">
            You can also browse all pharmacies without sharing your location.
          </p>

          {searchOrigin && (
            <div className="mt-3 flex items-start justify-between gap-3 rounded-2xl bg-[var(--brand-soft)] px-3 py-3">
              <p className="min-w-0 text-sm leading-5 text-[var(--brand-strong)]">
                <span className="font-extrabold">Near:</span>{" "}
                <span className="break-words">{searchOrigin.label}</span>
              </p>
              <div className="flex shrink-0 gap-2">
                <button
                  type="button"
                  onClick={() => setManualSearchOpen(true)}
                  className="text-xs font-extrabold text-[var(--brand-strong)] underline"
                >
                  Change
                </button>
                <button
                  type="button"
                  onClick={clearSearchOrigin}
                  className="flex items-center gap-1 text-xs font-extrabold text-[var(--brand-strong)] underline"
                >
                  <X className="size-3.5" aria-hidden="true" />
                  Clear
                </button>
              </div>
            </div>
          )}

          <button
            type="button"
            onClick={requestLocation}
            disabled={geolocationStatus === "locating" || gpsUnavailable}
            className="mt-3 flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl bg-[var(--brand)] px-5 text-sm font-extrabold text-white transition-colors hover:bg-[var(--brand-strong)] disabled:cursor-not-allowed disabled:opacity-60"
          >
            <LocateFixed className="size-5" aria-hidden="true" />
            {geolocationStatus === "locating"
              ? "Finding your location…"
              : gpsUnavailable
                ? "Location unavailable"
                : searchOrigin?.source === "gps"
                  ? "Update my location"
                  : "Use my location"}
          </button>

          <button
            type="button"
            onClick={() => setManualSearchOpen((open) => !open)}
            className="mt-2 flex min-h-11 w-full items-center justify-center gap-2 rounded-2xl border border-[var(--line-strong)] bg-white px-5 text-sm font-extrabold text-[var(--brand-strong)]"
          >
            <Search className="size-4" aria-hidden="true" />
            Enter area or address
          </button>

          {(manualSearchOpen || gpsUnavailable) && (
            <div className="mt-3 rounded-2xl bg-[var(--surface-muted)] p-3">
              <form onSubmit={searchManualLocation} className="flex gap-2">
                <label htmlFor="manual-location" className="sr-only">
                  Hotel, area, landmark, or address in Paphos
                </label>
                <input
                  id="manual-location"
                  value={manualQuery}
                  onChange={(event) => changeManualQuery(event.target.value)}
                  placeholder="Hotel / area / address"
                  minLength={MINIMUM_MANUAL_QUERY_CHARACTERS}
                  maxLength={120}
                  className="min-h-11 min-w-0 flex-1 rounded-xl border border-[var(--line-strong)] bg-white px-3 text-sm text-[var(--ink)] outline-none focus:border-[var(--brand)]"
                />
                <button
                  type="submit"
                  disabled={manualSearchStatus === "searching"}
                  className="min-h-11 shrink-0 rounded-xl bg-[var(--brand-strong)] px-4 text-sm font-extrabold text-white disabled:cursor-wait disabled:opacity-60"
                >
                  {manualSearchStatus === "searching" ? "Searching…" : "Search"}
                </button>
              </form>

              {manualSuggestions.length > 0 && (
                <div className="mt-3">
                  <p className="text-xs font-extrabold uppercase tracking-[0.1em] text-[var(--ink-muted)]">
                    Choose a matching location
                  </p>
                  <ul className="mt-2 space-y-2">
                    {manualSuggestions.map((suggestion) => (
                      <li key={suggestion.resultIdentifier}>
                        <button
                          type="button"
                          onClick={() => chooseManualLocation(suggestion)}
                          className="flex min-h-11 w-full items-start gap-2 rounded-xl border border-[var(--line)] bg-white px-3 py-2.5 text-left text-sm font-semibold leading-5 text-[var(--ink)]"
                        >
                          <MapPin className="mt-0.5 size-4 shrink-0 text-[var(--brand)]" aria-hidden="true" />
                          {suggestion.label}
                        </button>
                      </li>
                    ))}
                  </ul>
                  <p className="mt-2 text-right text-[0.7rem] text-[var(--ink-muted)]">
                    <a
                      className="underline"
                      href="https://www.geoapify.com/"
                      target="_blank"
                      rel="noreferrer"
                    >
                      Powered by Geoapify
                    </a>
                  </p>
                </div>
              )}
            </div>
          )}

          <p
            aria-live="polite"
            className={`mt-2 min-h-5 text-xs leading-5 ${
              manualSearchError || gpsUnavailable
                ? "font-semibold text-[var(--danger)]"
                : "text-[var(--ink-muted)]"
            }`}
          >
            {manualSearchError ??
              locationMessage ??
              (searchOrigin
                ? "Distance is shown only for pharmacies with verified map coordinates; others remain listed without distance."
                : "Location is optional and requested only when you tap the button.")}
          </p>

          {searchOrigin && (
            <button
              type="button"
              onClick={clearSearchOrigin}
              className="mt-1 text-xs font-bold text-[var(--ink-muted)] underline"
            >
              Browse all pharmacies instead
            </button>
          )}
        </div>
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
            {visibleResults.length < results.length
              ? `Showing ${visibleResults.length} of ${results.length}`
              : `${results.length} ${results.length === 1 ? "result" : "results"}`}
          </span>
        </div>

        {results.length > 0 ? (
          <div className="space-y-4">
            {visibleResults.map((result) => (
              <PharmacyCard
                key={result.pharmacy.id}
                result={result}
                selectedDay={selectedDay}
                now={now}
                ordinaryOpeningDataAvailable={ordinaryOpeningDataAvailable}
              />
            ))}
            {visibleResults.length < results.length && (
              <button
                type="button"
                onClick={() => setResultsExpanded(true)}
                className="flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl border border-[var(--line-strong)] bg-white px-5 text-sm font-extrabold text-[var(--brand-strong)] transition-colors hover:bg-[var(--surface-muted)]"
              >
                <ChevronDown className="size-5" aria-hidden="true" />
                Show all {results.length} pharmacies
              </button>
            )}
          </div>
        ) : (
          <div className="rounded-3xl border border-dashed border-[var(--line-strong)] bg-[var(--surface)] px-5 py-10 text-center">
            <h3 className="font-extrabold text-[var(--ink)]">No pharmacies match this filter</h3>
            <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-[var(--ink-muted)]">
              Try All to see every pharmacy with its recorded periods and contact actions.
            </p>
            <button
              type="button"
              onClick={() => chooseFilter("all")}
              className="mt-4 min-h-11 rounded-2xl border border-[var(--line-strong)] px-5 text-sm font-bold text-[var(--brand-strong)]"
            >
              Show all
            </button>
          </div>
        )}
      </section>

      <footer className="py-7 text-center text-xs leading-5 text-[var(--ink-muted)]">
        Dates and duty-rule times use Europe/Nicosia. “Confirmed Open” means an active official mandatory duty-open interval; overnight duty is telephone availability, not an open premises claim.
      </footer>
    </main>
  );
}
