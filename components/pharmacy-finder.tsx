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
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { LanguageSelector } from "@/components/language-selector";

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
  deriveOfficialDutyStatus,
  officialDutyRuleAppliesAtInstant,
  officialDutyScheduleForDate,
} from "@/lib/domain/duty-hours";
import {
  deriveOfficialRegularStatus,
  officialRegularRuleSupportsDate,
  officialRegularScheduleForDate,
  type OfficialRegularStatus,
} from "@/lib/domain/regular-hours";
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
import { LOCALE_FORMAT_IDS, localePath } from "@/lib/i18n/config";
import { formatLocalizedNumber, formatResultCount, message } from "@/lib/i18n/messages";
import type { FinderMessages, Locale } from "@/lib/i18n/types";
import {
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
  locale: Locale;
  messages: FinderMessages;
  languageLabel: string;
}

const filters: Record<SelectedDay, AvailabilityFilter[]> = {
  today: [
    "all",
    "open_now",
    "on_duty",
  ],
  tomorrow: [
    "all",
    "on_duty",
  ],
};

function intervalLabel(interval: AvailabilityInterval, messages: FinderMessages): string {
  if (interval.scheduleKind === "ordinary") return messages.recordedRegularOpen;
  if (interval.serviceMode === "open") return messages.recordedDutyOpen;
  if (interval.serviceMode === "on_call") return messages.recordedDutyOnCall;
  return messages.recordedDutyUnknown;
}

function intervalTime(interval: AvailabilityInterval, intlLocale: string): string {
  const startsOn = formatCyprusDate(interval.startsAt, intlLocale);
  const endsOn = formatCyprusDate(interval.endsAt, intlLocale);
  const end = `${endsOn === startsOn ? "" : `${endsOn} · `}${formatCyprusTime(interval.endsAt, intlLocale)}`;
  return `${startsOn} · ${formatCyprusTime(interval.startsAt, intlLocale)}–${end}`;
}

function TimeMessage({ template, time }: { template: string; time: string }) {
  const [before, ...after] = template.split("{time}");
  return (
    <>
      {before}
      <bdi dir="ltr">{time}</bdi>
      {after.join("{time}")}
    </>
  );
}

function BidiStableText({ text }: { text: string }) {
  return text
    .split(
      /([0-9٠-٩]{2}:[0-9٠-٩]{2}(?:[–-][0-9٠-٩]{2}:[0-9٠-٩]{2})?|Europe\/Nicosia)/g,
    )
    .map((part, index) =>
      /^(?:[0-9٠-٩]{2}:[0-9٠-٩]{2}|Europe\/Nicosia)/.test(part) ? (
        <bdi key={`${part}-${index}`} dir="ltr">
          {part}
        </bdi>
      ) : (
        part
      ),
    );
}

function regularClosedMessage(
  status: OfficialRegularStatus,
  messages: FinderMessages,
  intlLocale: string,
): { template: string; time?: string } {
  if (status.closureReason === "afternoon_break" && status.nextOpenAt) {
    return {
      template: messages.afternoonBreak,
      time: formatCyprusTime(status.nextOpenAt, intlLocale),
    };
  }
  if (status.closureReason === "before_open" && status.nextOpenAt) {
    return {
      template: messages.regularOpensAt,
      time: formatCyprusTime(status.nextOpenAt, intlLocale),
    };
  }
  if (status.closureReason === "public_holiday") {
    return { template: messages.closedPublicHoliday };
  }
  if (status.closureReason === "sunday") {
    return { template: messages.closedRegularSchedule };
  }
  return { template: messages.regularHoursEnded };
}

function StatusBadges({
  pharmacy,
  now,
  ordinaryOpeningDataAvailable,
  messages,
}: {
  pharmacy: Pharmacy;
  now: Date;
  ordinaryOpeningDataAvailable: boolean;
  messages: FinderMessages;
}) {
  const availability = deriveAvailability(pharmacy.intervals, now, {
    dutyAssignments: pharmacy.dutyAssignments,
    ordinaryOpeningCoverageKnown: ordinaryOpeningDataAvailable,
    applyOfficialRegularSchedule: true,
  });
  const officialDuty = deriveOfficialDutyStatus(pharmacy.dutyAssignments, now);
  const officialRegular = deriveOfficialRegularStatus(now);

  if (
    availability.openNow === "unknown" &&
    availability.activeIntervals.length === 0 &&
    availability.activeDutyAssignments.length === 0 &&
    officialDuty.mode === "inactive" &&
    officialRegular.mode === "unknown"
  ) {
    return (
      <span className="rounded-full bg-[var(--surface-muted)] px-3 py-1.5 text-[0.68rem] font-extrabold tracking-[0.08em] text-[var(--ink-muted)]">
        {messages.hoursUnavailableBadge}
      </span>
    );
  }

  return (
    <>
      {availability.openNow === true && (
        <span className="rounded-full bg-[var(--brand-soft)] px-3 py-1.5 text-[0.68rem] font-extrabold tracking-[0.08em] text-[var(--brand-strong)]">
          {messages.openNowBadge}
        </span>
      )}
      {availability.openNow === false && availability.onCall !== true && (
        <span className="rounded-full bg-[var(--surface-muted)] px-3 py-1.5 text-[0.68rem] font-extrabold tracking-[0.08em] text-[var(--ink-muted)]">
          {messages.closedBadge}
        </span>
      )}
      {officialDuty.onDutyToday && (
        <span className="rounded-full bg-[#e8eef9] px-3 py-1.5 text-[0.68rem] font-extrabold tracking-[0.08em] text-[#304f83]">
          {messages.onDutyTodayBadge}
        </span>
      )}
      {availability.onDuty &&
        !officialDuty.onDutyToday &&
        officialDuty.mode !== "on_call" && (
          <span className="rounded-full bg-[#e8eef9] px-3 py-1.5 text-[0.68rem] font-extrabold tracking-[0.08em] text-[#304f83]">
            {messages.onDutyBadge}
          </span>
        )}
      {availability.onCall === true && (
        <span className="rounded-full bg-[var(--amber-soft)] px-3 py-1.5 text-[0.68rem] font-extrabold tracking-[0.08em] text-[var(--amber)]">
          {messages.onCallBadge}
        </span>
      )}
      {officialDuty.mode === "unknown" && (
        <span className="rounded-full bg-[var(--amber-soft)] px-3 py-1.5 text-[0.68rem] font-extrabold tracking-[0.08em] text-[var(--amber)]">
          {messages.dutyHoursUnavailableBadge}
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
  locale,
  messages,
}: {
  result: PharmacyResult;
  selectedDay: SelectedDay;
  now: Date;
  ordinaryOpeningDataAvailable: boolean;
  locale: Locale;
  messages: FinderMessages;
}) {
  const intlLocale = LOCALE_FORMAT_IDS[locale];
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
  const officialRegularSchedule = officialRegularScheduleForDate(dayWindow.localDate);
  const availability = deriveAvailability(pharmacy.intervals, now, {
    dutyAssignments: pharmacy.dutyAssignments,
    ordinaryOpeningCoverageKnown: ordinaryOpeningDataAvailable,
    applyOfficialRegularSchedule: true,
  });
  const officialDuty = deriveOfficialDutyStatus(pharmacy.dutyAssignments, now);
  const officialRegular = deriveOfficialRegularStatus(now);
  const regularClosed = regularClosedMessage(officialRegular, messages, intlLocale);
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
            messages={messages}
          />
        </div>
      )}

      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h3 className="text-lg font-extrabold tracking-[-0.02em] text-[var(--ink)]">
            <bdi dir="auto">{pharmacy.name}</bdi>
          </h3>
          <p className="mt-1.5 flex items-start gap-2 text-sm leading-5 text-[var(--ink-muted)]">
            <MapPin className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <bdi dir="auto" className="break-words">{address}</bdi>
          </p>
        </div>
        {distanceKm !== null && (
          <span dir="ltr" className="shrink-0 rounded-xl bg-[var(--surface-muted)] px-2.5 py-1.5 text-sm font-bold text-[var(--brand-strong)]">
            ≈ {formatDistance(distanceKm, intlLocale)}
          </span>
        )}
      </div>

      {availability.hasConflict && selectedDay === "today" && (
        <div className="mt-4 flex gap-2 rounded-2xl border border-[#edc983] bg-[var(--amber-soft)] p-3 text-sm leading-5 text-[#68420b]">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <p>
            <strong>{messages.conflictTitle}</strong> {messages.conflictBody}
          </p>
        </div>
      )}

      {selectedDay === "today" && officialDuty.mode === "open" && officialDuty.activePeriod && (
        <div className="mt-4 rounded-2xl border border-[#b9dfcf] bg-[var(--brand-soft)] p-3 text-sm leading-5 text-[var(--brand-strong)]">
          <strong>
            <TimeMessage
              template={messages.dutyOpenUntil}
              time={formatCyprusTime(officialDuty.activePeriod.endsAt, intlLocale)}
            />
          </strong>
        </div>
      )}

      {selectedDay === "today" &&
        officialDuty.mode !== "open" &&
        officialDuty.mode !== "on_call" &&
        officialRegular.mode === "open" &&
        officialRegular.activePeriod && (
          <div className="mt-4 rounded-2xl border border-[#b9dfcf] bg-[var(--brand-soft)] p-3 text-sm leading-5 text-[var(--brand-strong)]">
            <strong>
              <TimeMessage
                template={messages.regularOpenUntil}
                time={formatCyprusTime(officialRegular.activePeriod.endsAt, intlLocale)}
              />
            </strong>
          </div>
        )}

      {selectedDay === "today" &&
        availability.openNow === false &&
        officialDuty.mode !== "on_call" &&
        officialRegular.mode === "closed" && (
          <div className="mt-4 rounded-2xl border border-[var(--line)] bg-[var(--surface-muted)] p-3 text-sm leading-5 text-[var(--ink-muted)]">
            <strong>
              {regularClosed.time ? (
                <TimeMessage template={regularClosed.template} time={regularClosed.time} />
              ) : (
                regularClosed.template
              )}
            </strong>
          </div>
        )}

      {selectedDay === "today" &&
        officialDuty.mode === "scheduled_gap" &&
        officialRegular.mode !== "open" && (
          <div className="mt-4 rounded-2xl border border-[#cbd8ed] bg-[#f0f5fc] p-3 text-sm leading-5 text-[#304f83]">
            <strong>{messages.scheduledGapTitle}</strong>{" "}
            {officialDuty.nextOpenAt
              ? <TimeMessage
                  template={messages.dutyStartsAt}
                  time={formatCyprusTime(officialDuty.nextOpenAt, intlLocale)}
                />
              : messages.dutyNotOpenNow}
          </div>
        )}

      {selectedDay === "today" && officialDuty.mode === "on_call" && (
        <div className="mt-4 rounded-2xl border border-[#edc983] bg-[var(--amber-soft)] p-3 text-sm leading-5 text-[#68420b]">
          <strong>{messages.onCallBadge}</strong>
          <p><BidiStableText text={messages.overnightPhone} /></p>
        </div>
      )}

      <div className="mt-4 border-t border-[var(--line)] pt-4">
        <div className="mb-2 flex items-center gap-2 text-xs font-extrabold uppercase tracking-[0.12em] text-[var(--ink-muted)]">
          <Clock3 className="size-4" aria-hidden="true" />
          {selectedDay === "today" ? messages.todayHours : messages.tomorrowHours}
        </div>
        {officialRegularSchedule !== null ||
        relevantIntervals.length > 0 ||
        relevantDutyAssignments.length > 0 ? (
          <ul className="space-y-2">
            {officialRegularSchedule?.openPeriods.map((regularPeriod, index) => (
              <li
                key={`official-regular-${dayWindow.localDate}-${index}`}
                className="flex items-start justify-between gap-3 text-sm leading-5"
              >
                <span className="font-semibold text-[var(--ink)]">
                  {messages.regularPharmacyHours}
                </span>
                <span dir="ltr" className="text-end text-[var(--ink-muted)]">
                  {formatCyprusTime(regularPeriod.startsAt, intlLocale)}–
                  {formatCyprusTime(regularPeriod.endsAt, intlLocale)}
                </span>
              </li>
            ))}
            {officialRegularSchedule?.closedAllDayReason && (
              <li className="flex items-start justify-between gap-3 text-sm leading-5">
                <span className="font-semibold text-[var(--ink)]">
                  {messages.regularPharmacyHours}
                </span>
                <span className="text-end text-[var(--ink-muted)]">
                  {officialRegularSchedule.closedAllDayReason === "public_holiday"
                    ? messages.closedPublicHoliday
                    : messages.sunday}
                </span>
              </li>
            )}
            {relevantIntervals.map((interval) => (
              <li key={interval.id} className="flex items-start justify-between gap-3 text-sm leading-5">
                <span className="font-semibold text-[var(--ink)]">{intervalLabel(interval, messages)}</span>
                <span dir="ltr" className="text-end text-[var(--ink-muted)]">{intervalTime(interval, intlLocale)}</span>
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
                          {messages.dutyPharmacyHours}
                        </span>
                        <span dir="ltr" className="text-end text-[var(--ink-muted)]">
                          {formatCyprusTime(dutyPeriod.startsAt, intlLocale)}–
                          {formatCyprusTime(dutyPeriod.endsAt, intlLocale)}
                        </span>
                      </li>
                    )),
                    <li
                      key={`${assignment.id}-on-call`}
                      className="flex items-start justify-between gap-3 text-sm leading-5"
                    >
                      <span className="font-semibold text-[var(--ink)]">
                        <BidiStableText text={messages.afterTwentyThree} />
                      </span>
                      <span className="text-end text-[var(--ink-muted)]">
                        <BidiStableText text={messages.nextDay} />
                      </span>
                    </li>,
                  ]
                : [
                    <li
                      key={assignment.id}
                      className="flex items-start justify-between gap-3 text-sm leading-5"
                    >
                      <span className="font-semibold text-[var(--ink)]">
                        {messages.onDuty}
                      </span>
                      <span className="text-end text-[var(--ink-muted)]">
                        {messages.hoursUnavailable}
                      </span>
                    </li>,
                  ],
            )}
          </ul>
        ) : (
          <p className="text-sm leading-5 text-[var(--ink-muted)]">
            {messages.hoursUnavailableForDay}
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
            {messages.call}
          </a>
        ) : (
          <span className="flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-[var(--surface-muted)] px-4 text-sm font-extrabold text-[var(--ink-muted)]">
            <Phone className="size-4" aria-hidden="true" />
            {messages.phoneUnavailable}
          </span>
        )}
        <a
          className="flex min-h-12 items-center justify-center gap-2 rounded-2xl border border-[var(--line-strong)] bg-white px-4 text-sm font-extrabold text-[var(--brand-strong)] transition-colors hover:bg-[var(--surface-muted)]"
          href={directions}
          target="_blank"
          rel="noreferrer"
        >
          <Navigation className="size-4" aria-hidden="true" />
          {messages.directions}
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
  locale,
  messages,
  languageLabel,
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
  const currentLocalDate = getCyprusDayWindow(now).localDate;
  const openNowFilterAvailable =
    ordinaryOpeningDataAvailable ||
    officialRegularRuleSupportsDate(currentLocalDate) ||
    officialDutyRuleAppliesAtInstant(now);

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
      true,
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
        applyOfficialRegularSchedule: true,
      });
      const rightAvailability = deriveAvailability(right.pharmacy.intervals, now, {
        dutyAssignments: right.pharmacy.dutyAssignments,
        ordinaryOpeningCoverageKnown: ordinaryOpeningDataAvailable,
        applyOfficialRegularSchedule: true,
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
          gpsSearchOrigin(
            {
              latitude: position.coords.latitude,
              longitude: position.coords.longitude,
            },
            messages.yourLocation,
          ),
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
      setManualSearchError(messages.minimumSearch);
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
        };
        if (!response.ok) {
          throw new Error(
            response.status === 429 ? messages.searchRateLimited : messages.searchUnavailable,
          );
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
          messages.noLocationMatch,
        );
      })
      .catch((error: unknown) => {
        if (isManualSearchCancellation(error)) return;
        setManualSearchStatus("error");
        setManualSearchError(
          error instanceof Error &&
            (error.message === messages.searchRateLimited ||
              error.message === messages.searchUnavailable)
            ? error.message
            : messages.searchUnavailable,
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
  const locationMessage =
    geolocationStatus === "denied" || geolocationStatus === "unavailable"
      ? messages.locationDenied
      : geolocationStatus === "locating"
        ? messages.findingLocation
        : null;

  return (
    <main className="mx-auto min-h-screen w-full max-w-3xl px-4 py-5 sm:px-6 sm:py-8">
      <header className="mb-5 flex items-start gap-3">
        <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-[var(--brand)] text-white shadow-sm">
          <Plus className="size-7 stroke-[3]" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-extrabold tracking-[-0.025em] text-[var(--ink)]">
            Paphos Pharmacy
          </h1>
          <p className="text-sm text-[var(--ink-muted)]">
            {messages.heroDescription}
          </p>
        </div>
        <LanguageSelector locale={locale} label={languageLabel} />
      </header>

      {source === "fixtures" && (
        <aside className="mb-4 rounded-2xl border border-[#ead8ae] bg-[var(--amber-soft)] px-4 py-3 text-sm leading-5 text-[#68420b]">
          <strong>{messages.developmentTitle}</strong> {messages.developmentBody}
        </aside>
      )}

      {attribution && (
        <aside className="mb-4 rounded-2xl border border-[var(--line)] bg-[var(--surface)] px-4 py-3 text-sm leading-6 text-[var(--ink-muted)]">
          {messages.attributionPrefix}{" "}
          <a
            className="font-bold underline"
            href={attribution.datasetPage}
            target="_blank"
            rel="noreferrer"
          >
            <bdi dir="auto">{attribution.organization}</bdi> {messages.attributionSourcesSuffix}
          </a>{" "}
          (<a className="underline" href={attribution.licenseUrl} target="_blank" rel="noreferrer">
            {attribution.license}
          </a>). {messages.attributionWarning}{" "}
          <Link className="font-bold text-[var(--brand-strong)] underline" href={localePath(locale, "/data-sources")}>
            {messages.dataSources}
          </Link>
        </aside>
      )}

      <section aria-label={messages.searchControls} className="mb-5 rounded-3xl border border-[var(--line)] bg-[var(--surface)] p-4 shadow-[var(--shadow)]">
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
              {day === "today" ? messages.today : messages.tomorrow}
            </button>
          ))}
        </div>

        <div className="mt-3 flex gap-2 overflow-x-auto pb-1" aria-label={messages.availabilityFilter}>
          {filters[selectedDay]
            .filter((option) => option !== "open_now" || openNowFilterAvailable)
            .map((option) => (
              <button
                key={option}
                type="button"
                aria-pressed={filter === option}
                onClick={() => chooseFilter(option)}
                className={`min-h-10 shrink-0 rounded-full border px-4 text-sm font-bold transition-colors ${
                  filter === option
                    ? "border-[var(--brand)] bg-[var(--brand-soft)] text-[var(--brand-strong)]"
                    : "border-[var(--line)] bg-white text-[var(--ink-muted)] hover:border-[var(--line-strong)]"
                }`}
              >
                {option === "all"
                  ? messages.all
                  : option === "open_now"
                    ? messages.openNow
                    : messages.onDuty}
              </button>
            ))}
        </div>

        {openNowFilterAvailable && (
          <p className="mt-2 text-xs leading-5 text-[var(--ink-muted)]">
            {messages.openNowExplanation}
          </p>
        )}

        <div className="mt-4 border-t border-[var(--line)] pt-4">
          <h2 className="text-base font-extrabold text-[var(--ink)]">
            {messages.findNear}
          </h2>
          <p className="mt-1 text-sm leading-5 text-[var(--ink-muted)]">
            {messages.browseWithoutLocation}
          </p>

          {searchOrigin && (
            <div className="mt-3 flex items-start justify-between gap-3 rounded-2xl bg-[var(--brand-soft)] px-3 py-3">
              <p className="min-w-0 text-sm leading-5 text-[var(--brand-strong)]">
                <span className="font-extrabold">{messages.near}</span>{" "}
                <bdi dir="auto" className="break-words">{searchOrigin.label}</bdi>
              </p>
              <div className="flex shrink-0 gap-2">
                <button
                  type="button"
                  onClick={() => setManualSearchOpen(true)}
                  className="text-xs font-extrabold text-[var(--brand-strong)] underline"
                >
                  {messages.change}
                </button>
                <button
                  type="button"
                  onClick={clearSearchOrigin}
                  className="flex items-center gap-1 text-xs font-extrabold text-[var(--brand-strong)] underline"
                >
                  <X className="size-3.5" aria-hidden="true" />
                  {messages.clear}
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
              ? messages.findingLocation
              : gpsUnavailable
                ? messages.locationUnavailable
                : searchOrigin?.source === "gps"
                  ? messages.updateLocation
                  : messages.useLocation}
          </button>

          <button
            type="button"
            onClick={() => setManualSearchOpen((open) => !open)}
            className="mt-2 flex min-h-11 w-full items-center justify-center gap-2 rounded-2xl border border-[var(--line-strong)] bg-white px-5 text-sm font-extrabold text-[var(--brand-strong)]"
          >
            <Search className="size-4" aria-hidden="true" />
            {messages.enterArea}
          </button>

          {(manualSearchOpen || gpsUnavailable) && (
            <div className="mt-3 rounded-2xl bg-[var(--surface-muted)] p-3">
              <form onSubmit={searchManualLocation} className="flex gap-2">
                <label htmlFor="manual-location" className="sr-only">
                  {messages.locationInputLabel}
                </label>
                <input
                  id="manual-location"
                  value={manualQuery}
                  onChange={(event) => changeManualQuery(event.target.value)}
                  placeholder={messages.locationPlaceholder}
                  dir="auto"
                  minLength={MINIMUM_MANUAL_QUERY_CHARACTERS}
                  maxLength={120}
                  className="min-h-11 min-w-0 flex-1 rounded-xl border border-[var(--line-strong)] bg-white px-3 text-sm text-[var(--ink)] outline-none focus:border-[var(--brand)]"
                />
                <button
                  type="submit"
                  disabled={manualSearchStatus === "searching"}
                  className="min-h-11 shrink-0 rounded-xl bg-[var(--brand-strong)] px-4 text-sm font-extrabold text-white disabled:cursor-wait disabled:opacity-60"
                >
                  {manualSearchStatus === "searching" ? messages.searching : messages.search}
                </button>
              </form>

              {manualSuggestions.length > 0 && (
                <div className="mt-3">
                  <p className="text-xs font-extrabold uppercase tracking-[0.1em] text-[var(--ink-muted)]">
                    {messages.chooseLocation}
                  </p>
                  <ul className="mt-2 space-y-2">
                    {manualSuggestions.map((suggestion) => (
                      <li key={suggestion.resultIdentifier}>
                        <button
                          type="button"
                          onClick={() => chooseManualLocation(suggestion)}
                          className="flex min-h-11 w-full items-start gap-2 rounded-xl border border-[var(--line)] bg-white px-3 py-2.5 text-start text-sm font-semibold leading-5 text-[var(--ink)]"
                        >
                          <MapPin className="mt-0.5 size-4 shrink-0 text-[var(--brand)]" aria-hidden="true" />
                          <bdi dir="auto">{suggestion.label}</bdi>
                        </button>
                      </li>
                    ))}
                  </ul>
                  <p className="mt-2 text-end text-[0.7rem] text-[var(--ink-muted)]">
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
                ? messages.distanceCoverage
                : messages.locationOptional)}
          </p>

          {searchOrigin && (
            <button
              type="button"
              onClick={clearSearchOrigin}
              className="mt-1 text-xs font-bold text-[var(--ink-muted)] underline"
            >
              {messages.browseAllInstead}
            </button>
          )}
        </div>
      </section>

      <section aria-labelledby="results-heading">
        <div className="mb-3 flex items-end justify-between gap-4">
          <div>
            <p className="text-xs font-extrabold uppercase tracking-[0.16em] text-[var(--brand)]">
              {selectedDay === "today" ? messages.todayInPaphos : messages.tomorrowSchedule}
            </p>
            <h2 id="results-heading" className="mt-1 text-lg font-extrabold tracking-[-0.015em]">
              {messages.pharmacyResults}
            </h2>
          </div>
          <span className="shrink-0 text-sm font-semibold text-[var(--ink-muted)]">
            {visibleResults.length < results.length
              ? message(messages.showingResults, {
                  visible: formatLocalizedNumber(visibleResults.length, locale),
                  total: formatLocalizedNumber(results.length, locale),
                })
              : formatResultCount(results.length, locale, messages)}
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
                locale={locale}
                messages={messages}
              />
            ))}
            {visibleResults.length < results.length && (
              <button
                type="button"
                onClick={() => setResultsExpanded(true)}
                className="flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl border border-[var(--line-strong)] bg-white px-5 text-sm font-extrabold text-[var(--brand-strong)] transition-colors hover:bg-[var(--surface-muted)]"
              >
                <ChevronDown className="size-5" aria-hidden="true" />
                {message(messages.showAllPharmacies, {
                  count: formatLocalizedNumber(results.length, locale),
                })}
              </button>
            )}
          </div>
        ) : (
          <div className="rounded-3xl border border-dashed border-[var(--line-strong)] bg-[var(--surface)] px-5 py-10 text-center">
            <h3 className="font-extrabold text-[var(--ink)]">{messages.noMatches}</h3>
            <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-[var(--ink-muted)]">
              {messages.noMatchesHelp}
            </p>
            <button
              type="button"
              onClick={() => chooseFilter("all")}
              className="mt-4 min-h-11 rounded-2xl border border-[var(--line-strong)] px-5 text-sm font-bold text-[var(--brand-strong)]"
            >
              {messages.showAll}
            </button>
          </div>
        )}
      </section>

      <section aria-label={messages.scheduleLocationNotes} className="space-y-2 py-7 text-center text-xs leading-5 text-[var(--ink-muted)]">
        <p>
          <BidiStableText text={messages.scheduleNote} />
        </p>
        {coordinateAttributions.length > 0 && (
          <p>
            {messages.locationData}{" "}
            {coordinateAttributions.map((item, index) => (
              <span key={item.providerId}>
                {index > 0 ? " · " : ""}
                <a
                  className="font-bold underline"
                  dir="auto"
                  href={item.attributionUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  {item.attribution}
                </a>
              </span>
            ))}
            . {messages.officialAddressesUnchanged}
          </p>
        )}
      </section>
    </main>
  );
}
