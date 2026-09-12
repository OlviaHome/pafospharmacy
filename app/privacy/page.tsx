import type { Metadata } from "next";

import { InformationPage } from "@/components/information-page";
import { CONTACT_EMAIL } from "@/lib/content/site";

export const metadata: Metadata = {
  title: "Privacy | Paphos Pharmacy",
  description: "How Paphos Pharmacy handles location searches and technical data.",
};

export default function PrivacyPage() {
  return (
    <InformationPage
      title="Privacy"
      introduction="This page explains the limited information used by the current Paphos Pharmacy website and what happens when you use its location tools."
    >
      <section>
        <h2 className="text-xl font-extrabold">What we collect</h2>
        <p className="mt-2">
          The application does not build a user profile. A manual location search sends
          the search text to our server, as explained below. Vercel may process standard
          technical request information needed to deliver and protect the website, such as
          an IP address, browser or device details, request time, and operational logs.
        </p>
        <p className="mt-2">
          If you email us, we receive your email address and the information you choose to
          include so that we can reply or review a correction. Please do not include medical
          or other sensitive personal information.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-extrabold">What we do not collect</h2>
        <p className="mt-2">
          You can use the pharmacy finder without an account. The website does not ask for
          your name, medical history, prescriptions, symptoms, or other medical records. The
          current application code does not run advertising or product analytics and does
          not use tracking profiles.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-extrabold">Location</h2>
        <p className="mt-2">
          If you tap <strong>Use my location</strong>, your browser asks for permission to
          read your device location. The coordinates are kept in the current browser tab
          and used there to calculate approximate distance to pharmacies. The application
          does not send that precise GPS location to its server, Supabase, or a geocoding
          provider, and it does not save it after the page is closed or refreshed.
        </p>
        <p className="mt-2">
          Your browser, device, and operating system control the permission prompt and may
          apply their own location-service settings.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-extrabold">Manual area or address search</h2>
        <p className="mt-2">
          If you enter an area, landmark, hotel, street, or address, the search text is
          sent to the Paphos Pharmacy server. The server checks a short shared cache and,
          when a lookup is needed, sends the text to Geoapify to find possible Paphos
          locations. Successful normalized searches and their short result lists may be
          cached in Vercel&apos;s shared runtime cache for up to five minutes. The selected
          result is then kept only in the current browser tab.
        </p>
        <p className="mt-2">
          Geoapify and Vercel may process request and network information under their own
          policies. Do not enter medical details or other sensitive personal information
          in the location box.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-extrabold">Hosting and service providers</h2>
        <p className="mt-2">
          Vercel hosts and serves the website. Supabase stores the public pharmacy, duty,
          and trusted location records used by the application. Supabase does not receive
          your GPS origin or manual search origin through the current application flow.
          Geoapify receives manual search text only when a provider lookup is needed.
        </p>
        <ul className="mt-2 list-disc space-y-2 pl-5">
          <li>
            <a className="font-bold underline" href="https://vercel.com/legal/privacy-notice">
              Vercel
            </a>{" "}
            hosts and serves the application.
          </li>
          <li>
            <a className="font-bold underline" href="https://supabase.com/privacy">
              Supabase
            </a>{" "}
            hosts the public pharmacy-data backend.
          </li>
          <li>
            <a className="font-bold underline" href="https://www.geoapify.com/privacy-policy/">
              Geoapify
            </a>{" "}
            receives manual location searches when a provider lookup is needed.
          </li>
        </ul>
        <p className="mt-2">
          The current application code does not set cookies, use local storage or session
          storage, or save preferences. Search origins and filters are held in memory and
          reset when the page reloads.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-extrabold">Why we process technical data</h2>
        <p className="mt-2">
          Technical request information is processed only as needed to deliver, secure,
          troubleshoot, and protect the service from abuse. Manual search text is processed
          to return relevant Paphos location suggestions. Contact emails are used to reply
          and to review the issue raised. We do not use this information for advertising or
          medical profiling.
        </p>
        <p className="mt-2">
          Where data-protection law requires a legal basis, this limited processing is
          intended to rely on the legitimate interest in operating, securing, and
          troubleshooting the service, except where another basis is required. An email you
          send is handled so that we can respond to your request.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-extrabold">Retention</h2>
        <p className="mt-2">
          Successful normalized manual searches and their short result lists may remain in
          Vercel&apos;s shared runtime cache for up to five minutes. GPS and selected search
          origins are not saved by the application after the page reloads.
        </p>
        <p className="mt-2">
          We do not state a fixed period for hosting logs, provider records, or contact
          emails because it has not been verified from current provider configuration and
          operating practice. Those services may keep security or operational records under
          their own settings, agreements, and policies. Contact correspondence should not be
          kept longer than reasonably needed to respond or address the issue.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-extrabold">Your rights</h2>
        <p className="mt-2">
          Depending on the law that applies, you may have rights relating to personal
          information about you, including access, correction, deletion, restriction, or
          objection. You may also have the right to complain to the relevant data-protection
          authority. Contact us using the email below if you want to make a request.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-extrabold">Third-party links</h2>
        <p className="mt-2">
          Directions and source links open other websites. Their privacy terms apply once
          you follow those links. Google Maps is contacted only when you choose a Google
          Maps Directions link. Other source and attribution links work in the same way.
        </p>
        <p className="mt-2">
          See the{" "}
          <a className="font-bold underline" href="https://policies.google.com/privacy">
            Google Privacy Policy
          </a>{" "}
          before using Google Maps if you want more information about its processing.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-extrabold">Changes</h2>
        <p className="mt-2">
          This page will be updated when the application begins using information in a
          materially different way. The latest update date appears at the top of the page.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-extrabold">Contact</h2>
        <p className="mt-2">
          For privacy questions or requests, email{" "}
          <a className="font-bold underline" href={`mailto:${CONTACT_EMAIL}`}>
            {CONTACT_EMAIL}
          </a>.
        </p>
      </section>
    </InformationPage>
  );
}
