"use client";

import {
  AlertTriangle,
  ArrowUp,
  ChevronDown,
  Clock3,
  LocateFixed,
  MapPin,
  Navigation,
  Phone,
  Search,
  X,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

import { FinderHeader } from "@/components/finder-header";
import { InstallAppCta } from "@/components/install-app-cta";

import {
  deriveAvailability,
  filterPharmaciesByAvailability,
  intervalsForWindow,
  type AvailabilityFilter,
} from "@/lib/domain/availability";
import {
  CYPRUS_TIME_ZONE,
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
import { LOCALE_FORMAT_IDS } from "@/lib/i18n/config";
import { SLUG_BY_DISTRICT } from "@/lib/i18n/district-pages";
import { localePath } from "@/lib/i18n/config";
import {
  canonicalPharmacyAddress,
  localizedPharmacyAddress,
  localizedPharmacyName,
} from "@/lib/i18n/address";
import { formatLocalizedNumber, message } from "@/lib/i18n/messages";
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
  type LocationSearchDistrict,
} from "@/lib/location/manual-search";

type SelectedDay = "today" | "tomorrow";
type ManualSearchStatus = "idle" | "searching" | "error";
type PharmacyDistrict = LocationSearchDistrict;

const districts: PharmacyDistrict[] = [
  "Nicosia",
  "Larnaca",
  "Limassol",
  "Paphos",
  "Famagusta",
];

const backToFinderLabels: Record<Locale, string> = {
  en: "Back to finder controls",
  el: "Επιστροφή στα φίλτρα αναζήτησης",
  ru: "Вернуться к фильтрам поиска",
  ar: "العودة إلى أدوات البحث",
};

const LOCATION_INTRO_STORAGE_KEY = "pharmacy_location_intro_v1";
const LOCATION_INTRO_MARKER_VERSION = 1;

function hasFreshLocationIntroMarker(rawMarker: string | null, now: Date): boolean {
  if (!rawMarker) return false;

  try {
    const marker = JSON.parse(rawMarker) as {
      version?: unknown;
      shownAt?: unknown;
    };
    if (
      marker.version !== LOCATION_INTRO_MARKER_VERSION ||
      typeof marker.shownAt !== "string"
    ) {
      return false;
    }

    const shownAt = new Date(marker.shownAt);
    if (!Number.isFinite(shownAt.getTime()) || shownAt > now) return false;
    const expiresAt = new Date(shownAt);
    expiresAt.setUTCMonth(expiresAt.getUTCMonth() + 6);
    return now < expiresAt;
  } catch {
    return false;
  }
}

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
  initialDistrict?: PharmacyDistrict;
  districtPage?: boolean;
  heroTitle?: string;
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

function BidiStableText({ text }: { text: string }) {
  return text
    .split(
      /([0-9٠-٩]{2}:[0-9٠-٩]{2}(?:[–-][0-9٠-٩]{2}:[0-9٠-٩]{2})?|Asia\/Nicosia)/g,
    )
    .map((part, index) =>
      /^(?:[0-9٠-٩]{2}:[0-9٠-٩]{2}|Asia\/Nicosia)/.test(part) ? (
        <bdi key={`${part}-${index}`} dir="ltr">
          {part}
        </bdi>
      ) : (
        part
      ),
    );
}

interface DisplayPeriod {
  startsAt: string;
  endsAt: string;
}

function mergeDisplayPeriods(periods: DisplayPeriod[]): DisplayPeriod[] {
  return [...periods]
    .sort((left, right) => left.startsAt.localeCompare(right.startsAt))
    .reduce<DisplayPeriod[]>((merged, periodValue) => {
      const previous = merged.at(-1);
      if (!previous || new Date(periodValue.startsAt) > new Date(previous.endsAt)) {
        merged.push({ ...periodValue });
        return merged;
      }
      if (new Date(periodValue.endsAt) > new Date(previous.endsAt)) {
        previous.endsAt = periodValue.endsAt;
      }
      return merged;
    }, []);
}

function formatPeriod(periodValue: DisplayPeriod, intlLocale: string): string {
  return `${formatCyprusTime(periodValue.startsAt, intlLocale)}–${formatCyprusTime(periodValue.endsAt, intlLocale)}`;
}

function formatPhoneDisplay(phoneE164: string): string {
  const cyprusNumber = /^\+357(\d{2})(\d{6})$/.exec(phoneE164);
  return cyprusNumber ? `${cyprusNumber[1]} ${cyprusNumber[2]}` : phoneE164;
}

function formatDutyBadgeDate(instant: string, intlLocale: string): string {
  return new Intl.DateTimeFormat(intlLocale, {
    timeZone: CYPRUS_TIME_ZONE,
    weekday: "short",
    day: "numeric",
    month: "short",
  })
    .formatToParts(new Date(instant))
    .filter((part) => part.type === "weekday" || part.type === "day" || part.type === "month")
    .map((part) => part.value)
    .join(" ")
    .toLocaleUpperCase(intlLocale);
}

function formatPluralCount(
  value: number,
  locale: Locale,
  templates: Pick<FinderMessages, "resultOne" | "resultFew" | "resultMany" | "resultOther">,
): string {
  const category = new Intl.PluralRules(LOCALE_FORMAT_IDS[locale]).select(value);
  const template =
    category === "one"
      ? templates.resultOne
      : category === "few"
        ? templates.resultFew
        : category === "many"
          ? templates.resultMany
          : templates.resultOther;
  return message(template, { count: formatLocalizedNumber(value, locale) });
}

function StatusBadges({
  pharmacy,
  now,
  ordinaryOpeningDataAvailable,
  intlLocale,
  messages,
}: {
  pharmacy: Pharmacy;
  now: Date;
  ordinaryOpeningDataAvailable: boolean;
  intlLocale: string;
  messages: FinderMessages;
}) {
  const availability = deriveAvailability(pharmacy.intervals, now, {
    dutyAssignments: pharmacy.dutyAssignments,
    ordinaryOpeningCoverageKnown: ordinaryOpeningDataAvailable,
    applyOfficialRegularSchedule: true,
  });
  const officialDuty = deriveOfficialDutyStatus(pharmacy.dutyAssignments, now);
  const officialRegular = deriveOfficialRegularStatus(now);
  const todayDutySchedule = officialDuty.onDutyToday && officialDuty.assignment
    ? officialDutyScheduleForDate(officialDuty.assignment.dutyDate)
    : null;

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
        <span className="rounded-full bg-[rgb(190,255,80)] px-3 py-1.5 text-[0.68rem] font-extrabold tracking-[0.08em] text-[#17210b]">
          {messages.openNowBadge}
        </span>
      )}
      {availability.openNow === false && availability.onCall !== true && (
        <span className="rounded-full bg-[var(--surface-muted)] px-3 py-1.5 text-[0.68rem] font-extrabold tracking-[0.08em] text-[var(--ink-muted)]">
          {messages.closedBadge}
        </span>
      )}
      {officialDuty.onDutyToday &&
        officialDuty.mode !== "on_call" &&
        todayDutySchedule && (
        <span className="rounded-full bg-[#FF956A] px-3 py-1.5 text-[0.68rem] font-extrabold tracking-[0.08em] text-[#3d170b]">
          <BidiStableText
            text={message(messages.onDutyTodayBadge, {
              time: formatCyprusTime(todayDutySchedule.onCallPeriod.startsAt, intlLocale),
            })}
          />
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
  const relevantOfficialDutySchedules = relevantDutyAssignments
    .map((assignment) => officialDutyScheduleForDate(assignment.dutyDate))
    .filter((schedule) => schedule !== null);
  const officialRegularSchedule = officialRegularScheduleForDate(dayWindow.localDate);
  const availability = deriveAvailability(pharmacy.intervals, now, {
    dutyAssignments: pharmacy.dutyAssignments,
    ordinaryOpeningCoverageKnown: ordinaryOpeningDataAvailable,
    applyOfficialRegularSchedule: true,
  });
  const officialDuty = deriveOfficialDutyStatus(pharmacy.dutyAssignments, now);
  const effectiveOpenPeriods = mergeDisplayPeriods([
    ...(officialRegularSchedule?.openPeriods ?? []),
    ...relevantOfficialDutySchedules.flatMap((schedule) => schedule.openPeriods),
  ]);
  const onCallPeriod = relevantOfficialDutySchedules[0]?.onCallPeriod ?? null;
  const tomorrowDutySchedule =
    selectedDay === "tomorrow" ? relevantOfficialDutySchedules[0] ?? null : null;
  const canonicalAddress = canonicalPharmacyAddress(pharmacy);
  const displayName = localizedPharmacyName(pharmacy, locale);
  const displayAddress = localizedPharmacyAddress(pharmacy, locale);
  const directionsQuery =
    pharmacy.latitude !== null && pharmacy.longitude !== null
      ? `${pharmacy.latitude},${pharmacy.longitude}`
      : canonicalAddress;
  const directions = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(directionsQuery)}`;
  const showConflictGuidance =
    availability.hasConflict && selectedDay === "today";
  const showOvernightGuidance =
    selectedDay === "today" && officialDuty.mode === "on_call";
  const showDaytimeDutyGuidance =
    selectedDay === "today" &&
    officialDuty.onDutyToday &&
    officialDuty.mode !== "on_call" &&
    onCallPeriod !== null;
  const hasDutyGuidance =
    showConflictGuidance || showOvernightGuidance || showDaytimeDutyGuidance;

  return (
    <article
      data-pharmacy-card
      className="pharmacy-card flex h-full flex-col rounded-[1.25rem] bg-[var(--surface)] p-5 shadow-[var(--shadow)] sm:p-6"
    >
      <div className="pharmacy-card__surface" aria-hidden="true" />

      <div
        data-card-region="identity"
        className="pharmacy-card__identity min-w-0"
      >
        {(selectedDay === "today" || tomorrowDutySchedule) && (
          <div className="mb-4 flex min-h-6 flex-wrap gap-2">
            {selectedDay === "today" ? (
              <StatusBadges
                pharmacy={pharmacy}
                now={now}
                ordinaryOpeningDataAvailable={ordinaryOpeningDataAvailable}
                intlLocale={intlLocale}
                messages={messages}
              />
            ) : tomorrowDutySchedule ? (
              <span className="rounded-full bg-[#e8eef9] px-3 py-1.5 text-[0.68rem] font-extrabold tracking-[0.08em] text-[#304f83]">
                <BidiStableText
                  text={message(messages.onDutyTomorrowBadge, {
                    date: formatDutyBadgeDate(dayWindow.start, intlLocale),
                    time: formatCyprusTime(
                      tomorrowDutySchedule.onCallPeriod.startsAt,
                      intlLocale,
                    ),
                  })}
                />
              </span>
            ) : null}
          </div>
        )}

        <div className="min-w-0">
          <h3 className="text-xl font-extrabold tracking-[-0.025em] text-[var(--ink)]">
            <bdi dir="auto">{displayName.text}</bdi>
          </h3>
          <p className="mt-2 flex items-start gap-2 text-sm leading-5 text-[var(--ink-muted)]">
            <MapPin className="mt-0.5 size-4 shrink-0 text-[var(--brand)]" aria-hidden="true" />
            <bdi dir="auto" className="break-words">{displayAddress.text}</bdi>
          </p>
        </div>
      </div>

      <div data-card-region="duty" className="pharmacy-card__duty-slot">
        {hasDutyGuidance && (
          <div data-card-panel="duty" className="mt-4 space-y-4">
            {showConflictGuidance && (
              <div className="flex gap-2 rounded-xl bg-[var(--amber-soft)] p-3 text-sm leading-5 text-[#68420b]">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                <p>
                  <strong>{messages.conflictTitle}</strong> {messages.conflictBody}
                </p>
              </div>
            )}

            {showOvernightGuidance && (
              <div className="rounded-xl bg-[var(--amber-soft)] px-4 py-3 text-sm leading-5 text-[#68420b]">
                <strong>{messages.onCallBadge}</strong>
                <p>
                  <BidiStableText
                    text={message(messages.overnightPhone, {
                      start: officialDuty.activePeriod
                        ? formatCyprusTime(officialDuty.activePeriod.startsAt, intlLocale)
                        : "",
                      end: officialDuty.activePeriod
                        ? formatCyprusTime(officialDuty.activePeriod.endsAt, intlLocale)
                        : "",
                    })}
                  />
                </p>
              </div>
            )}

            {showDaytimeDutyGuidance && onCallPeriod && (
              <div className="rounded-xl bg-[var(--stone-soft)] px-4 py-3 text-sm leading-5 text-[var(--ink-muted)]">
                <BidiStableText
                  text={message(messages.dutyDayPhoneNotice, {
                    start: formatCyprusTime(onCallPeriod.startsAt, intlLocale),
                    end: formatCyprusTime(onCallPeriod.endsAt, intlLocale),
                  })}
                />
              </div>
            )}
          </div>
        )}
      </div>

      <div
        data-card-region="hours"
        data-card-panel="hours"
        className="pharmacy-card__hours mt-4 rounded-xl bg-[var(--surface-muted)] p-4"
      >
        <div className="mb-3 flex items-center gap-2 text-sm font-extrabold text-[var(--ink)]">
          <Clock3 className="size-5 text-[var(--brand)]" aria-hidden="true" />
          {selectedDay === "today" ? messages.todayHours : messages.tomorrowHours}
        </div>
        {effectiveOpenPeriods.length > 0 || relevantIntervals.length > 0 ? (
          <ul className="space-y-2 text-sm leading-5">
            {effectiveOpenPeriods.map((periodValue, index) => (
              <li
                key={`effective-${dayWindow.localDate}-${index}`}
                className="font-semibold text-[var(--ink)]"
              >
                <BidiStableText
                  text={message(messages.effectiveOpenToday, {
                    hours: formatPeriod(periodValue, intlLocale),
                  })}
                />
              </li>
            ))}
            {relevantIntervals.map((interval) => (
              <li key={interval.id} className="flex items-start justify-between gap-3">
                <span className="font-semibold text-[var(--ink)]">{intervalLabel(interval, messages)}</span>
                <span dir="ltr" className="text-end text-[var(--ink-muted)]">{intervalTime(interval, intlLocale)}</span>
              </li>
            ))}
            {onCallPeriod && (
              <li className="text-[var(--ink-muted)]">
                <BidiStableText
                  text={message(messages.afterDutyHours, {
                    time: formatCyprusTime(onCallPeriod.startsAt, intlLocale),
                  })}
                />
              </li>
            )}
          </ul>
        ) : officialRegularSchedule?.closedAllDayReason ? (
          <p className="text-sm font-semibold text-[var(--ink-muted)]">
            {officialRegularSchedule.closedAllDayReason === "public_holiday"
              ? messages.closedPublicHoliday
              : messages.closedRegularSchedule}
          </p>
        ) : relevantDutyAssignments.length > 0 ? (
          <p className="text-sm font-semibold text-[var(--ink-muted)]">
            {messages.hoursUnavailable}
          </p>
        ) : (
          <p className="text-sm text-[var(--ink-muted)]">
            {messages.hoursUnavailableForDay}
          </p>
        )}
      </div>

      <div data-card-region="proximity" className="pharmacy-card__proximity">
        {distanceKm !== null && (
          <p className="mt-4 flex items-center gap-2 text-xs font-semibold text-[var(--ink-muted)]">
            <MapPin className="size-4 shrink-0 text-[var(--brand)]" aria-hidden="true" />
            <span dir="ltr" className="shrink-0 whitespace-nowrap">
              ≈ {formatDistance(distanceKm, intlLocale)}
            </span>
            <span className="min-w-0">
              <span aria-hidden="true">{"·\u00a0"}</span>
              {messages.distanceMethod}
            </span>
          </p>
        )}
      </div>

      <div
        data-card-region="actions"
        className="pharmacy-card__actions mt-auto grid grid-cols-2 gap-3 pt-5"
      >
        {pharmacy.phoneE164 ? (
          <a
            className="flex min-h-14 items-center justify-center gap-2 rounded-xl bg-[var(--brand)] px-3 text-sm font-extrabold text-white transition-colors hover:bg-[var(--brand-strong)]"
            href={`tel:${pharmacy.phoneE164}`}
            aria-label={`${messages.call}: ${formatPhoneDisplay(pharmacy.phoneE164)}`}
          >
            <Phone className="size-5" aria-hidden="true" />
            <bdi dir="ltr">{formatPhoneDisplay(pharmacy.phoneE164)}</bdi>
          </a>
        ) : (
          <span className="flex min-h-14 items-center justify-center gap-2 rounded-xl bg-[var(--surface-muted)] px-3 text-sm font-extrabold text-[var(--ink-muted)]">
            <Phone className="size-5" aria-hidden="true" />
            {messages.phoneUnavailable}
          </span>
        )}
        <a
          className="flex min-h-14 items-center justify-center gap-2 rounded-xl border border-[var(--line-strong)] bg-white px-3 text-sm font-extrabold text-[var(--brand-strong)] transition-colors hover:bg-[var(--surface-muted)]"
          href={directions}
          target="_blank"
          rel="noreferrer"
        >
          <Navigation className="size-5" aria-hidden="true" />
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
  initialDistrict = "Paphos",
  districtPage = false,
  heroTitle,
}: PharmacyFinderProps) {
  const [selectedDay, setSelectedDay] = useState<SelectedDay>("today");
  const [selectedDistrict, setSelectedDistrict] =
    useState<PharmacyDistrict>(initialDistrict);
  const [filter, setFilter] = useState<AvailabilityFilter>("all");
  const [now, setNow] = useState(() => new Date(generatedAt));
  const [searchOrigin, setSearchOrigin] = useState<SearchOrigin | null>(null);
  const [geolocationStatus, setGeolocationStatus] =
    useState<GeolocationStatus>("idle");
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
  const [showBackToFinder, setShowBackToFinder] = useState(false);
  const [showLocationIntro, setShowLocationIntro] = useState(false);
  const locationIntroDialogRef = useRef<HTMLDialogElement>(null);
  const locationIntroYesRef = useRef<HTMLButtonElement>(null);
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

  useEffect(() => {
    const activeTab = document.querySelector<HTMLElement>(
      `[data-district-tab="${selectedDistrict}"]`,
    );
    if (!districtPage) {
      activeTab?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
      return;
    }
    const tabStrip = activeTab?.closest<HTMLElement>("#finder-top");
    if (!activeTab || !tabStrip) return;
    const tabBounds = activeTab.getBoundingClientRect();
    const stripBounds = tabStrip.getBoundingClientRect();
    const horizontalOffset = tabBounds.left < stripBounds.left
      ? tabBounds.left - stripBounds.left
      : tabBounds.right > stripBounds.right
        ? tabBounds.right - stripBounds.right
        : 0;
    if (horizontalOffset !== 0) tabStrip.scrollBy?.({ left: horizontalOffset });
  }, [districtPage, selectedDistrict]);

  useEffect(() => {
    const updateBackToFinderVisibility = () => {
      const controls = document.getElementById("finder-controls");
      const threshold = controls
        ? controls.offsetTop + controls.offsetHeight + 240
        : 720;
      setShowBackToFinder(window.scrollY > threshold);
    };

    updateBackToFinderVisibility();
    window.addEventListener("scroll", updateBackToFinderVisibility, {
      passive: true,
    });
    window.addEventListener("resize", updateBackToFinderVisibility);
    return () => {
      window.removeEventListener("scroll", updateBackToFinderVisibility);
      window.removeEventListener("resize", updateBackToFinderVisibility);
    };
  }, []);

  useEffect(() => {
    const shownAt = new Date();
    let shouldShow = true;

    try {
      shouldShow = !hasFreshLocationIntroMarker(
        window.localStorage.getItem(LOCATION_INTRO_STORAGE_KEY),
        shownAt,
      );
    } catch {
      // Storage can be unavailable in private or restricted browser contexts.
    }

    if (!shouldShow) return;
    let cancelled = false;
    window.queueMicrotask(() => {
      if (cancelled) return;
      setShowLocationIntro(true);
      try {
        window.localStorage.setItem(
          LOCATION_INTRO_STORAGE_KEY,
          JSON.stringify({
            version: LOCATION_INTRO_MARKER_VERSION,
            shownAt: shownAt.toISOString(),
          }),
        );
      } catch {
        // The informational prompt remains usable without persistent storage.
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!showLocationIntro) return;
    const dialog = locationIntroDialogRef.current;
    const previouslyFocused =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    if (dialog && !dialog.open && typeof dialog.showModal === "function") {
      dialog.showModal();
    } else if (dialog && !dialog.open) {
      dialog.setAttribute("open", "");
    }
    const focusTimer = window.setTimeout(() => {
      locationIntroYesRef.current?.focus();
    }, 0);

    return () => {
      window.clearTimeout(focusTimer);
      previouslyFocused?.focus();
    };
  }, [showLocationIntro]);

  const dayWindow = useMemo(
    () => getCyprusDayWindow(now, selectedDay === "tomorrow" ? 1 : 0),
    [now, selectedDay],
  );
  const districtPharmacies = useMemo(
    () => pharmacies.filter((pharmacy) => pharmacy.district === selectedDistrict),
    [pharmacies, selectedDistrict],
  );
  const normalizedPharmacyQuery = searchOrigin
    ? ""
    : manualQuery.trim().normalize("NFKC").toLocaleLowerCase(LOCALE_FORMAT_IDS[locale]);
  const searchedPharmacies = useMemo(() => {
    if (!normalizedPharmacyQuery) return districtPharmacies;
    return districtPharmacies.filter((pharmacy) =>
      [
        pharmacy.name,
        pharmacy.addressLine,
        pharmacy.addressAdditional,
        pharmacy.locality,
        pharmacy.postalCode,
      ]
        .filter((value): value is string => Boolean(value))
        .some((value) =>
          value
            .normalize("NFKC")
            .toLocaleLowerCase(LOCALE_FORMAT_IDS[locale])
            .includes(normalizedPharmacyQuery),
        ),
    );
  }, [districtPharmacies, locale, normalizedPharmacyQuery]);
  const results = useMemo(() => {
    const matching = filterPharmaciesByAvailability(
      searchedPharmacies,
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
  }, [coordinates, dayWindow, filter, now, ordinaryOpeningDataAvailable, searchedPharmacies]);
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

  function chooseDistrict(district: PharmacyDistrict) {
    manualLocationLookup.cancel();
    setSelectedDistrict(district);
    setSearchOrigin((current) =>
      current?.source === "manual" ? null : current,
    );
    setManualSuggestions([]);
    setManualSearchError(null);
    setManualSearchStatus("idle");
    setResultsExpanded(false);
  }

  function chooseFilter(nextFilter: AvailabilityFilter) {
    setFilter(nextFilter);
    setResultsExpanded(false);
  }

  function requestLocation() {
    if (!("geolocation" in navigator)) {
      setGeolocationStatus("unavailable");
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
          body: JSON.stringify({ query, district: selectedDistrict }),
          signal,
        });
        const body = (await response.json()) as {
          code?: string;
          suggestions?: ManualLocationSuggestion[];
        };
        if (!response.ok) {
          throw new Error(
            response.status === 429 && body.code === "client_rate_limited"
              ? messages.searchRateLimited
              : messages.searchUnavailable,
          );
        }
        return body.suggestions ?? [];
      }, selectedDistrict)
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
    if (searchOrigin) setSearchOrigin(null);
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
    setManualQuery(suggestion.label);
    setResultsExpanded(false);
  }

  function clearSearchOrigin() {
    setSearchOrigin(null);
    setManualQuery("");
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

  const districtNames: Record<PharmacyDistrict, string> = {
    Nicosia: messages.districtNicosia,
    Larnaca: messages.districtLarnaca,
    Limassol: messages.districtLimassol,
    Paphos: messages.districtPaphos,
    Famagusta: messages.districtFamagusta,
  };
  const dutyCount = districtPharmacies.filter((pharmacy) =>
    pharmacy.dutyAssignments.some(
      (assignment) => assignment.dutyDate === dayWindow.localDate,
    ),
  ).length;
  const pharmacyCountLabel = formatPluralCount(
    districtPharmacies.length,
    locale,
    {
      resultOne: messages.pharmacyCountOne,
      resultFew: messages.pharmacyCountFew,
      resultMany: messages.pharmacyCountMany,
      resultOther: messages.pharmacyCountOther,
    },
  );
  const dutyCountLabel = formatPluralCount(dutyCount, locale, {
    resultOne: messages.dutyCountOne,
    resultFew: messages.dutyCountFew,
    resultMany: messages.dutyCountMany,
    resultOther: messages.dutyCountOther,
  });
  return (
    <main className="min-h-screen w-full bg-white pb-8">
      <FinderHeader
        locale={locale}
        brandName={messages.brandName}
        blog={messages.blog}
        about={messages.about}
        dataSources={messages.dataSources}
        languageLabel={languageLabel}
      />

      {showLocationIntro && (
        <dialog
          ref={locationIntroDialogRef}
          aria-labelledby="location-intro-title"
          aria-describedby="location-intro-body"
          onCancel={(event) => {
            event.preventDefault();
            setShowLocationIntro(false);
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              setShowLocationIntro(false);
            }
          }}
          className="fixed inset-0 z-[60] m-auto w-[calc(100%-2rem)] max-w-sm rounded-2xl border border-[var(--line)] bg-white p-0 text-[var(--ink)] shadow-[0_24px_70px_rgba(16,15,15,0.22)] backdrop:bg-black/35 backdrop:backdrop-blur-[2px]"
        >
          <div className="p-5 sm:p-6">
            <h2
              id="location-intro-title"
              className="text-xl font-semibold tracking-[-0.02em]"
            >
              {messages.locationIntroTitle}
            </h2>
            <p
              id="location-intro-body"
              className="mt-2 text-sm leading-6 text-[var(--ink-muted)]"
            >
              {messages.locationIntroBody}
            </p>
            <div className="mt-5 grid grid-cols-2 gap-2">
              <button
                ref={locationIntroYesRef}
                type="button"
                onClick={() => {
                  setShowLocationIntro(false);
                  requestLocation();
                }}
                className="location-intro-action min-h-10 rounded-xl border border-[var(--line-strong)] bg-white px-4 py-2 text-sm font-medium text-[var(--ink)] hover:bg-[rgb(190,255,80)]"
              >
                {messages.locationIntroYes}
              </button>
              <button
                type="button"
                onClick={() => setShowLocationIntro(false)}
                className="location-intro-action min-h-10 rounded-xl border border-[var(--line-strong)] bg-white px-4 py-2 text-sm font-medium text-[var(--ink)] hover:bg-[#FF956A]"
              >
                {messages.locationIntroLater}
              </button>
            </div>
          </div>
        </dialog>
      )}

      <section className={`relative bg-[linear-gradient(120deg,var(--hero-dark),var(--brand-strong))] text-white ${districtPage && locale === "en" ? "max-[21rem]:min-h-[23.5rem]" : ""}`}>
        <div className="mx-auto flex w-full max-w-7xl flex-col justify-center px-4 py-12 sm:px-6 sm:py-16 lg:min-h-[22rem] lg:px-8 lg:py-16">
          <h1 className="max-w-5xl text-balance text-[clamp(2.5rem,5vw,4rem)] font-medium leading-[0.98] tracking-[-0.035em]">
            {heroTitle ?? messages.heroTitle}
          </h1>
          <h2 className="mt-4 max-w-6xl text-balance text-[clamp(1.125rem,2vw,1.5rem)] font-normal leading-[1.2] text-white/65 lg:whitespace-nowrap">
            {messages.heroSchedulePeriod}
          </h2>
          <InstallAppCta messages={messages} reserveSpace={districtPage} />
        </div>
      </section>

      <div className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8">

      {source === "fixtures" && (
        <aside className="mb-4 rounded-2xl border border-[#ead8ae] bg-[var(--amber-soft)] px-4 py-3 text-sm leading-5 text-[#68420b]">
          <strong>{messages.developmentTitle}</strong> {messages.developmentBody}
        </aside>
      )}

      <nav
        id="finder-top"
        aria-label={messages.districtSelector}
        className="scroll-mt-28 overflow-x-auto border-b border-[var(--line)] bg-white min-[24rem]:max-sm:overflow-x-hidden sm:scroll-mt-20"
      >
        <div className="mx-auto flex min-w-max justify-between gap-8 min-[24rem]:max-sm:grid min-[24rem]:max-sm:w-full min-[24rem]:max-sm:min-w-0 min-[24rem]:max-sm:grid-cols-5 min-[24rem]:max-sm:gap-0 sm:gap-12 lg:min-w-0 lg:max-w-5xl">
          {districts.map((district) => {
            const className = `relative flex min-h-16 min-w-11 shrink-0 items-center justify-center whitespace-nowrap px-1 text-sm font-bold transition-colors min-[24rem]:max-sm:w-full min-[24rem]:max-sm:min-w-0 min-[24rem]:max-sm:px-0 min-[24rem]:max-sm:text-[0.8125rem] sm:text-base ${
              selectedDistrict === district
                ? "text-[var(--ink)] after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:bg-[var(--brand)]"
                : "text-[var(--ink-muted)] hover:text-[var(--ink)]"
            }`;
            return districtPage ? (
              <Link
                key={district}
                href={localePath(locale, `/${SLUG_BY_DISTRICT[district]}`)}
                data-district-tab={district}
                aria-current={selectedDistrict === district ? "page" : undefined}
                className={className}
              >
                {districtNames[district]}
              </Link>
            ) : (
              <button
                key={district}
                type="button"
                data-district-tab={district}
                aria-pressed={selectedDistrict === district}
                onClick={() => chooseDistrict(district)}
                className={className}
              >
                {districtNames[district]}
              </button>
            );
          })}
        </div>
      </nav>

      <section id="finder-controls" aria-label={messages.searchControls} className="relative z-10 -mx-1 -mt-px mb-8 bg-white px-1 py-4 sm:mx-0 sm:rounded-b-2xl sm:px-5 sm:shadow-[var(--shadow)]">
        <div className="grid gap-3 lg:grid-cols-[auto_auto_minmax(18rem,1fr)_auto] lg:items-center">
        <div className="grid grid-cols-2 gap-1 rounded-xl bg-[var(--surface-muted)] p-1">
          {(["today", "tomorrow"] as const).map((day) => (
            <button
              key={day}
              type="button"
              aria-pressed={selectedDay === day}
              onClick={() => chooseDay(day)}
              className={`min-h-11 rounded-lg px-3 text-sm font-bold transition-colors sm:px-4 ${
                selectedDay === day
                  ? "bg-white text-[var(--brand-strong)] shadow-sm"
                  : "text-[var(--ink-muted)] hover:text-[var(--ink)]"
              }`}
            >
              {day === "today" ? messages.today : messages.tomorrow}
            </button>
          ))}
        </div>

        <div className="flex justify-center gap-2 overflow-x-auto sm:justify-start" aria-label={messages.availabilityFilter}>
          {filters[selectedDay]
            .filter((option) => option !== "open_now" || openNowFilterAvailable)
            .map((option) => (
              <button
                key={option}
                type="button"
                aria-pressed={filter === option}
                onClick={() => chooseFilter(option)}
                className={`min-h-11 shrink-0 rounded-lg border px-3 text-sm font-bold transition-colors sm:px-4 ${
                  filter === option
                    ? option === "on_duty"
                      ? "border-[#92c33e] bg-[rgb(190,255,80)] text-[#17210b]"
                      : "border-[var(--brand)] bg-[var(--brand-soft)] text-[var(--brand-strong)]"
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

        <div className="min-w-0">
          <form onSubmit={searchManualLocation} className="relative flex min-w-0 items-center">
            <label htmlFor="manual-location" className="sr-only">
              {messages.locationInputLabel}
            </label>
            <Search className="pointer-events-none absolute start-3 size-5 text-[var(--ink-muted)]" aria-hidden="true" />
            <input
              id="manual-location"
              value={manualQuery}
              onChange={(event) => changeManualQuery(event.target.value)}
              placeholder={messages.locationPlaceholder}
              dir="auto"
              minLength={MINIMUM_MANUAL_QUERY_CHARACTERS}
              maxLength={120}
              className="min-h-11 min-w-0 flex-1 rounded-xl border border-[var(--line)] bg-[var(--surface-muted)] pe-14 ps-11 text-sm text-[var(--ink)] outline-none placeholder:text-[var(--ink-muted)] focus:border-[var(--brand)] focus:bg-white sm:min-h-12"
            />
            <button
              type="submit"
              disabled={manualSearchStatus === "searching"}
              aria-label={messages.search}
              className="absolute end-0.5 grid size-11 place-items-center rounded-[0.65rem] bg-[var(--brand)] text-white transition-colors hover:bg-[var(--brand-strong)] disabled:cursor-wait disabled:opacity-60"
            >
              <Search className="size-4" aria-hidden="true" />
            </button>
          </form>

          {searchOrigin && (
            <div className="mt-2 flex items-start justify-between gap-3 rounded-xl bg-[var(--brand-soft)] px-3 py-2">
              <p className="min-w-0 text-sm leading-5 text-[var(--brand-strong)]">
                <span className="font-extrabold">{messages.near}</span>{" "}
                <bdi dir="auto" className="break-words">{searchOrigin.label}</bdi>
              </p>
              <button
                type="button"
                onClick={clearSearchOrigin}
                className="flex shrink-0 items-center gap-1 text-xs font-extrabold text-[var(--brand-strong)] underline"
              >
                <X className="size-3.5" aria-hidden="true" />
                {messages.clear}
              </button>
            </div>
          )}

          {manualSuggestions.length > 0 && (
            <div className="mt-2 rounded-xl border border-[var(--line)] bg-white p-2 shadow-[var(--shadow)]">
              <p className="px-2 py-1 text-xs font-extrabold uppercase tracking-[0.1em] text-[var(--ink-muted)]">
                {messages.chooseLocation}
              </p>
              <ul className="space-y-1">
                {manualSuggestions.map((suggestion) => (
                  <li key={suggestion.resultIdentifier}>
                    <button
                      type="button"
                      onClick={() => chooseManualLocation(suggestion)}
                      className="flex min-h-11 w-full items-start gap-2 rounded-lg px-2 py-2.5 text-start text-sm font-semibold leading-5 text-[var(--ink)] hover:bg-[var(--surface-muted)]"
                    >
                      <MapPin className="mt-0.5 size-4 shrink-0 text-[var(--brand)]" aria-hidden="true" />
                      <bdi dir="auto">{suggestion.label}</bdi>
                    </button>
                  </li>
                ))}
              </ul>
              <p className="px-2 pt-1 text-end text-[0.7rem] text-[var(--ink-muted)]">
                <a className="underline" href="https://www.geoapify.com/" target="_blank" rel="noreferrer">
                  Powered by Geoapify
                </a>
              </p>
            </div>
          )}

          {(manualSearchError || locationMessage) && (
            <p aria-live="polite" className="mt-2 text-xs font-semibold leading-5 text-[var(--danger)]">
              {manualSearchError ?? locationMessage}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={requestLocation}
          disabled={geolocationStatus === "locating" || gpsUnavailable}
          className="flex min-h-11 items-center justify-center gap-2 rounded-xl border border-[var(--line)] bg-white px-3 text-sm font-extrabold text-[var(--brand-strong)] transition-colors hover:bg-[var(--surface-muted)] disabled:cursor-not-allowed disabled:opacity-60 sm:min-h-12 sm:px-4"
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
        </div>
      </section>

      {showBackToFinder && (
        <button
          type="button"
          aria-label={backToFinderLabels[locale]}
          onClick={() => {
            document.getElementById("finder-top")?.scrollIntoView({
              behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
                ? "auto"
                : "smooth",
              block: "start",
            });
          }}
          className="fixed bottom-[max(1rem,env(safe-area-inset-bottom))] right-4 z-40 grid size-11 place-items-center rounded-full border border-[var(--line)] bg-white/90 text-[var(--brand-strong)] shadow-[0_8px_24px_rgba(16,15,15,0.14)] backdrop-blur-md transition-colors hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)] focus-visible:ring-offset-2 sm:right-6 sm:size-12"
        >
          <ArrowUp className="size-5" aria-hidden="true" />
        </button>
      )}

      <section aria-labelledby="results-heading">
        <h2 id="results-heading" className="mb-4 text-sm font-semibold text-[var(--ink-muted)] sm:text-base">
          {districtNames[selectedDistrict]} · {formatCyprusDate(dayWindow.start, LOCALE_FORMAT_IDS[locale])} · {pharmacyCountLabel} · {dutyCountLabel}
          {!districtPage && (
            <Link href={localePath(locale, `/${SLUG_BY_DISTRICT[selectedDistrict]}`)} className="ms-2 underline underline-offset-2">
              {districtNames[selectedDistrict]} ↗
            </Link>
          )}
        </h2>

        {results.length > 0 ? (
          <div className="space-y-4">
            {Array.from(
              { length: Math.ceil(visibleResults.length / 2) },
              (_, rowIndex) => {
                const rowResults = visibleResults.slice(
                  rowIndex * 2,
                  rowIndex * 2 + 2,
                );

                return (
                  <div
                    key={rowResults.map((result) => result.pharmacy.id).join(":")}
                    data-card-row
                    className="pharmacy-card-row"
                  >
                    {rowResults.map((result) => (
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
                  </div>
                );
              },
            )}
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
        <p>{messages.attributionWarning}</p>
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
        {attribution && (
          <p>
            <a className="font-bold underline" href={attribution.datasetPage} target="_blank" rel="noreferrer">
              {attribution.organization}
            </a>{" "}
            ·{" "}
            <a className="underline" href={attribution.licenseUrl} target="_blank" rel="noreferrer">
              {attribution.license}
            </a>
          </p>
        )}
      </section>
      </div>
    </main>
  );
}
