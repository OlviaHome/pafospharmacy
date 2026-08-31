import { getCyprusDayWindow, localDateTimeToInstant } from "@/lib/domain/date";
import type { AvailabilityInterval, Pharmacy } from "@/lib/domain/types";

function interval(
  id: string,
  pharmacyId: string,
  startsAt: Date | string | number,
  endsAt: Date | string | number,
  scheduleKind: AvailabilityInterval["scheduleKind"],
  serviceMode: AvailabilityInterval["serviceMode"],
): AvailabilityInterval {
  return {
    id,
    pharmacyId,
    startsAt: new Date(startsAt).toISOString(),
    endsAt: new Date(endsAt).toISOString(),
    scheduleKind,
    serviceMode,
  };
}

export function createFixturePharmacies(now: Date): Pharmacy[] {
  const tomorrow = getCyprusDayWindow(now, 1);
  const hour = 60 * 60 * 1000;
  const [year, month, day] = tomorrow.localDate.split("-").map(Number);
  const tomorrowAt = (localHour: number, minute = 0) =>
    localDateTimeToInstant({ year, month, day, hour: localHour, minute });

  return [
    {
      id: "fixture-harbour",
      name: "Harbour Demo Pharmacy",
      addressLine: "18 Poseidonos Avenue",
      locality: "Kato Paphos",
      postalCode: "8042",
      latitude: 34.7559,
      longitude: 32.4076,
      phoneE164: "+35726000001",
      intervals: [
        interval("h-ordinary-now", "fixture-harbour", now.getTime() - 2 * hour, now.getTime() + 5 * hour, "ordinary", "open"),
        interval("h-duty-now", "fixture-harbour", now.getTime() - hour, now.getTime() + 2 * hour, "duty", "open"),
        interval("h-ordinary-tomorrow", "fixture-harbour", tomorrowAt(9), tomorrowAt(19), "ordinary", "open"),
        interval("h-duty-tomorrow", "fixture-harbour", tomorrowAt(13, 30), tomorrowAt(16), "duty", "open"),
      ],
    },
    {
      id: "fixture-tombs",
      name: "Tombs Road Test Pharmacy",
      addressLine: "42 Tombs of the Kings Avenue",
      locality: "Paphos",
      postalCode: "8015",
      latitude: 34.7765,
      longitude: 32.4097,
      phoneE164: "+35726000002",
      intervals: [
        interval("t-ordinary-now", "fixture-tombs", now.getTime() - 2 * hour, now.getTime() + 2 * hour, "ordinary", "open"),
        interval("t-duty-now", "fixture-tombs", now.getTime() - hour, now.getTime() + 4 * hour, "duty", "on_call"),
        interval("t-duty-tomorrow", "fixture-tombs", tomorrowAt(8), tomorrowAt(12), "duty", "on_call"),
      ],
    },
    {
      id: "fixture-old-town",
      name: "Old Town Sample Pharmacy",
      addressLine: "7 Kennedy Square",
      locality: "Ktima",
      postalCode: "8010",
      latitude: 34.7761,
      longitude: 32.4218,
      phoneE164: "+35726000003",
      intervals: [
        interval("o-duty-now", "fixture-old-town", now.getTime() - 0.5 * hour, now.getTime() + 6 * hour, "duty", "unknown"),
        interval("o-duty-tomorrow", "fixture-old-town", tomorrowAt(20), tomorrowAt(23), "duty", "unknown"),
      ],
    },
    {
      id: "fixture-universal",
      name: "Universal Demo Pharmacy",
      addressLine: "12 Agapinoros Street",
      locality: "Universal",
      postalCode: "8036",
      latitude: 34.7608,
      longitude: 32.4274,
      phoneE164: "+35726000004",
      intervals: [
        interval("u-ordinary-now", "fixture-universal", now.getTime() - 3 * hour, now.getTime() + 3 * hour, "ordinary", "open"),
        interval("u-ordinary-tomorrow", "fixture-universal", tomorrowAt(8, 30), tomorrowAt(18), "ordinary", "open"),
      ],
    },
    {
      id: "fixture-chloraka",
      name: "Chloraka Test Pharmacy",
      addressLine: "31 Eleftherias Avenue",
      locality: "Chloraka",
      postalCode: "8220",
      latitude: 34.7986,
      longitude: 32.4072,
      phoneE164: "+35726000005",
      intervals: [],
    },
  ];
}
