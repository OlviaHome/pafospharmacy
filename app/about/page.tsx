import type { Metadata } from "next";

import { InformationPage } from "@/components/information-page";
import { CONTACT_EMAIL } from "@/lib/content/site";

export const metadata: Metadata = {
  title: "About | Paphos Pharmacy",
  description: "Why Paphos Pharmacy exists and how the independent service works.",
};

export default function AboutPage() {
  return (
    <InformationPage
      title="About"
      introduction="Paphos Pharmacy is a simple way to find a pharmacy in Paphos that should be open now or is listed on the official duty rota."
    >
      <section>
        <h2 className="text-xl font-extrabold">Why this service exists</h2>
        <p className="mt-2">
          Finding a pharmacy can be harder when ordinary business hours have ended, a
          pharmacy is closed for an afternoon break, or duty cover continues by telephone
          overnight. The information exists, but the useful answer is often spread across
          addresses, schedules, and rota records. Paphos Pharmacy brings those facts into
          one clear Paphos-focused view.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-extrabold">What it does</h2>
        <p className="mt-2">
          The service combines official Cyprus pharmacy records and duty assignments with
          the supported regular and duty schedule rules. It keeps regular opening, official
          duty assignment, and overnight telephone availability separate so that one label
          is not mistaken for another.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-extrabold">How to use it</h2>
        <ol className="mt-2 list-decimal space-y-2 pl-5">
          <li>Browse every Paphos pharmacy or filter by Open Now or On Duty.</li>
          <li>
            Use your device location, or select a Paphos area or address, to see approximate
            distance where verified coordinates are available.
          </li>
          <li>Use Call to contact the pharmacy or Directions to open Google Maps.</li>
        </ol>
        <p className="mt-2">No account is required.</p>
      </section>

      <section>
        <h2 className="text-xl font-extrabold">Web-first and English for now</h2>
        <p className="mt-2">
          Paphos Pharmacy is a mobile-first website that also works on desktop. English is
          the currently supported interface language. Multilingual support is planned, but
          no other language is offered yet.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-extrabold">Independent and informational</h2>
        <p className="mt-2">
          This is an independent service, not a Cyprus government or Pharmaceutical
          Services website. It does not provide medical advice and is not an emergency
          service. In a serious or life-threatening emergency in Cyprus, call{" "}
          <a className="font-bold underline" href="tel:112">
            112
          </a>.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-extrabold">Contact</h2>
        <p className="mt-2">
          Questions, corrections, and practical feedback are welcome at{" "}
          <a className="font-bold underline" href={`mailto:${CONTACT_EMAIL}`}>
            {CONTACT_EMAIL}
          </a>.
        </p>
      </section>
    </InformationPage>
  );
}
