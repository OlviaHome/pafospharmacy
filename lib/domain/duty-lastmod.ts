import { getCyprusDayWindow } from "./date";
import type { Pharmacy } from "./types";

type DutyPharmacy = Pick<Pharmacy, "id" | "district" | "dutyAssignments">;

interface DailyRosters {
  yesterday: Set<string>;
  today: Set<string>;
}

function sameMembers(left: Set<string>, right: Set<string>): boolean {
  return left.size === right.size && [...left].every((id) => right.has(id));
}

/**
 * Report a date only when the published duty roster actually changed at the
 * Cyprus calendar-day boundary. A new date by itself is not a content update.
 *
 * The dataset contains yesterday/today assignments; when the roster has not
 * changed, omit lastmod rather than inventing an older modification timestamp.
 */
export function dutyRosterLastmodByDistrict(
  pharmacies: readonly DutyPharmacy[],
  now: Date,
): Map<string, Date> {
  const today = getCyprusDayWindow(now);
  const yesterday = getCyprusDayWindow(now, -1);
  const rosters = new Map<string, DailyRosters>();

  for (const pharmacy of pharmacies) {
    if (!pharmacy.district) continue;
    for (const assignment of pharmacy.dutyAssignments) {
      if (
        assignment.dutyDate !== today.localDate &&
        assignment.dutyDate !== yesterday.localDate
      ) {
        continue;
      }
      let roster = rosters.get(pharmacy.district);
      if (!roster) {
        roster = { yesterday: new Set(), today: new Set() };
        rosters.set(pharmacy.district, roster);
      }
      const members =
        assignment.dutyDate === today.localDate ? roster.today : roster.yesterday;
      members.add(pharmacy.id);
    }
  }

  const changedAt = new Map<string, Date>();
  for (const [district, roster] of rosters) {
    if (!sameMembers(roster.yesterday, roster.today)) {
      changedAt.set(district, new Date(today.start));
    }
  }
  return changedAt;
}
