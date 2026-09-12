import type { Metadata } from "next";

import { InformationPage } from "@/components/information-page";
import { CONTACT_EMAIL } from "@/lib/content/site";

export const metadata: Metadata = {
  title: "Terms | Paphos Pharmacy",
  description: "Important terms for using the independent Paphos Pharmacy service.",
};

export default function TermsPage() {
  return (
    <InformationPage
      title="Terms"
      introduction="Paphos Pharmacy is an independent informational service designed to help people find pharmacies in Paphos. Please use its information with the limits below in mind."
    >
      <section>
        <h2 className="text-xl font-extrabold">Independent service</h2>
        <p className="mt-2">
          Paphos Pharmacy is not a government website and is not affiliated with or
          endorsed by the Cyprus Ministry of Health or Cyprus Pharmaceutical Services.
          It uses data published by Cyprus Pharmaceutical Services and identifies those
          sources separately.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-extrabold">What the service provides</h2>
        <p className="mt-2">
          The website presents pharmacy contact details, schedule-based availability,
          official duty assignments, approximate distance where trusted coordinates exist,
          and links for calling or directions. It is provided as practical information and
          may change or be temporarily unavailable.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-extrabold">Information, not medical advice</h2>
        <p className="mt-2">
          The website helps you locate and contact pharmacies. It does not diagnose a
          condition, recommend treatment, replace a doctor or pharmacist, or provide
          medical advice.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-extrabold">Not an emergency service</h2>
        <p className="mt-2">
          Do not rely on this website for emergency assistance. In a serious or
          life-threatening emergency in Cyprus, call{" "}
          <a className="font-bold underline" href="tel:112">112</a> or seek appropriate
          professional medical care.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-extrabold">Schedules and source data can change</h2>
        <p className="mt-2">
          Opening and duty labels are calculated from the published sources and supported
          official schedule rules described on the Data Sources page. Exceptional closures,
          late source updates, staffing issues, seasonal status, or other real-world changes
          may not appear immediately. Call the pharmacy when confirmation matters.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-extrabold">Location and external services</h2>
        <p className="mt-2">
          Distances are approximate straight-line calculations. Coordinates and official
          textual addresses can differ, and some pharmacies have no verified coordinates.
          Directions links open a third-party mapping service, which is responsible for its
          route, map content, availability, and terms. Check the destination before travelling.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-extrabold">Reasonable use</h2>
        <p className="mt-2">
          Use the service lawfully and do not attempt to disrupt it or exhaust third-party
          service quotas. These terms do not remove any rights or protections that cannot
          lawfully be excluded.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-extrabold">Changes and availability</h2>
        <p className="mt-2">
          The service, its sources, and these terms may be updated as the product changes.
          An updated date will be shown on this page. Access may occasionally be interrupted
          by maintenance, provider outages, source problems, or other technical issues.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-extrabold">Contact</h2>
        <p className="mt-2">
          For questions about these terms, email{" "}
          <a className="font-bold underline" href={`mailto:${CONTACT_EMAIL}`}>
            {CONTACT_EMAIL}
          </a>.
        </p>
      </section>
    </InformationPage>
  );
}
