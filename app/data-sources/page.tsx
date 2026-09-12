import type { Metadata } from "next";

import { InformationPage } from "@/components/information-page";
import { CONTACT_EMAIL } from "@/lib/content/site";
import { CYPRUS_DUTY_RULE_SOURCE_URL } from "@/lib/domain/duty-hours";
import { CYPRUS_REGULAR_RULE_SOURCE_URL } from "@/lib/domain/regular-hours";

export const metadata: Metadata = {
  title: "Data Sources & Disclaimer | Paphos Pharmacy",
  description: "Sources, freshness, and limitations of Paphos Pharmacy data.",
};

export default function DataSourcesPage() {
  return (
    <InformationPage
      title="Data Sources & Disclaimer"
      introduction="Paphos Pharmacy combines official Cyprus pharmacy records with separately attributed schedule and location information. The website itself is independent and is not an official government service."
    >
      <section>
        <h2 className="text-xl font-extrabold">Pharmacy directory and duty rota</h2>
        <p className="mt-2">
          Pharmacy identities, published addresses, public pharmacy telephone numbers,
          registration numbers, and date-only duty assignments come from the{" "}
          <a className="font-bold underline" href="https://www.data.gov.cy/en/dataset/817">
            Cyprus Pharmaceutical Services 2026 open-data release
          </a>. The source snapshot used by the service was retrieved on 31 August 2026 and contains duty
          assignments from 1 May through 30 September 2026. Source data is attributed
          under{" "}
          <a
            className="font-bold underline"
            href="https://creativecommons.org/licenses/by/4.0/"
          >
            CC BY 4.0
          </a>.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-extrabold">Regular pharmacy schedule</h2>
        <p className="mt-2">
          Regular hours are calculated from the{" "}
          <a className="font-bold underline" href={CYPRUS_REGULAR_RULE_SOURCE_URL}>
            Cyprus pharmacy-hours order
          </a>. The service supports the versioned 2026 summer/winter schedule
          and verified 2026 pharmacy-closure holidays in Europe/Nicosia time. It describes
          when a pharmacy should be open under the general schedule; it cannot detect an
          exceptional same-day closure.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-extrabold">Duty hours and overnight telephone cover</h2>
        <p className="mt-2">
          Duty-opening and overnight telephone periods are calculated only when an official
          duty assignment exists and the date is covered by the{" "}
          <a className="font-bold underline" href={CYPRUS_DUTY_RULE_SOURCE_URL}>
            Cyprus Pharmaceutical Services 2026 duty-hours notice
          </a>. “On duty” is not automatically the same as “open”. From 23:00 until 08:00
          after the duty date, the published rule requires telephone availability for
          prescriptions; the website does not label the premises open during that period.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-extrabold">Addresses, coordinates, and directions</h2>
        <p className="mt-2">
          The official textual address is preserved as source data, but it is not treated as
          proof of a verified physical destination. Coordinates are separate enrichment.
          Fresh exact Google Places identity matches are preferred temporarily for distance
          and Directions. Trusted OpenStreetMap Nominatim or Geoapify results are used only
          as fallbacks. Ambiguous matches and material provider disagreements are excluded
          from automatic routing.
        </p>
        <ul className="mt-3 list-disc space-y-2 pl-5">
          <li>
            <a className="font-bold underline" href="https://www.openstreetmap.org/copyright">
              © OpenStreetMap contributors
            </a>{" "}
            — Nominatim coordinate enrichment retrieved 31 August 2026.
          </li>
          <li>
            <a className="font-bold underline" href="https://www.geoapify.com/">
              Powered by Geoapify
            </a>{" "}
            — fallback enrichment retrieved 1 September 2026 and manual location search.
          </li>
          <li>
            <a className="font-bold underline" href="https://www.google.com/maps">
              Google Maps
            </a>{" "}
            — exact pharmacy identity links reconciled 3 September 2026; coordinate
            caches expire within 30 days.
          </li>
        </ul>
      </section>

      <section>
        <h2 className="text-xl font-extrabold">Current limitations and freshness</h2>
        <ul className="mt-2 list-disc space-y-2 pl-5">
          <li>
            Official imports and coordinate reconciliations are currently deliberate manual
            processes, not live government feeds.
          </li>
          <li>
            The supported duty rules and assignments end on 30 September 2026;
            unsupported dates are shown as unavailable rather than guessed.
          </li>
          <li>
            No official per-pharmacy seasonal registry is integrated, so seasonal status
            is not inferred for any Paphos pharmacy.
          </li>
          <li>
            Exceptional closures, temporary changes, and corrections may not be reflected
            immediately. Call before travelling when confirmation matters.
          </li>
          <li>
            Distance is shown only for pharmacies with trusted coordinates; pharmacies
            without them remain visible.
          </li>
        </ul>
      </section>

      <section>
        <h2 className="text-xl font-extrabold">Corrections</h2>
        <p className="mt-2">
          If you believe a pharmacy, schedule, phone number, or location is incorrect,
          please confirm with the pharmacy or original source and contact us at{" "}
          <a className="font-bold underline" href={`mailto:${CONTACT_EMAIL}`}>
            {CONTACT_EMAIL}
          </a>.
        </p>
      </section>
    </InformationPage>
  );
}
