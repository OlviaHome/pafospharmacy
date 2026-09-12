// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { SiteFooter } from "@/components/site-footer";
import { CONTACT_EMAIL } from "@/lib/content/site";

import AboutPage from "./about/page";
import DataSourcesPage from "./data-sources/page";
import PrivacyPage from "./privacy/page";
import TermsPage from "./terms/page";

afterEach(cleanup);

describe("legal and information pages", () => {
  it("explains the current product without claiming affiliation or PWA installation", () => {
    render(<AboutPage />);

    expect(screen.getByRole("heading", { name: "About" })).toBeTruthy();
    expect(screen.getByText(/brings those facts into one clear Paphos-focused view/)).toBeTruthy();
    expect(screen.getByText(/No account is required/)).toBeTruthy();
    expect(screen.getByText(/English is the currently supported interface language/)).toBeTruthy();
    expect(
      screen.getByText(/not a Cyprus government or Pharmaceutical Services website/),
    ).toBeTruthy();
    expect(screen.queryByText(/Add to Home Screen/i)).toBeNull();
    expect(screen.getByRole("link", { name: CONTACT_EMAIL }).getAttribute("href")).toBe(
      `mailto:${CONTACT_EMAIL}`,
    );
  });

  it("describes only the implemented privacy data flow", () => {
    render(<PrivacyPage />);

    expect(screen.getByRole("heading", { name: "Privacy" })).toBeTruthy();
    expect(screen.getByText(/without an account/)).toBeTruthy();
    expect(screen.getByText(/does not send that precise GPS location/)).toBeTruthy();
    expect(screen.getAllByText(/shared runtime cache for up to five minutes/)).toHaveLength(2);
    expect(screen.getByText(/does not set cookies, use local storage or session storage/)).toBeTruthy();
    expect(screen.getByText(/legitimate interest in operating, securing/)).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Your rights" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Geoapify" }).getAttribute("href")).toBe(
      "https://www.geoapify.com/privacy-policy/",
    );
    expect(screen.getByRole("link", { name: CONTACT_EMAIL }).getAttribute("href")).toBe(
      `mailto:${CONTACT_EMAIL}`,
    );
  });

  it("states the service, medical, emergency, and third-party limits", () => {
    render(<TermsPage />);

    expect(screen.getByText(/not affiliated with or endorsed by/)).toBeTruthy();
    expect(screen.getByText(/does not diagnose a condition/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "112" }).getAttribute("href")).toBe(
      "tel:112",
    );
    expect(screen.getByText(/Directions links open a third-party mapping service/)).toBeTruthy();
    expect(screen.getByText(/Call the pharmacy when confirmation matters/)).toBeTruthy();
    expect(screen.getByText(/may occasionally be interrupted by maintenance/)).toBeTruthy();
    expect(screen.getByRole("link", { name: CONTACT_EMAIL }).getAttribute("href")).toBe(
      `mailto:${CONTACT_EMAIL}`,
    );
  });

  it("retains every required source attribution and current limitation", () => {
    render(<DataSourcesPage />);

    expect(
      screen.getByRole("heading", { name: "Data Sources & Disclaimer" }),
    ).toBeTruthy();
    expect(screen.getByRole("link", { name: "CC BY 4.0" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "© OpenStreetMap contributors" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Powered by Geoapify" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Google Maps" })).toBeTruthy();
    expect(screen.getByText(/not live government feeds/)).toBeTruthy();
    expect(screen.getByText(/seasonal status is not inferred/)).toBeTruthy();
    expect(screen.getByText(/official textual address is preserved as source data/)).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Corrections" })).toBeTruthy();
    expect(screen.getByRole("link", { name: CONTACT_EMAIL }).getAttribute("href")).toBe(
      `mailto:${CONTACT_EMAIL}`,
    );
  });

  it("provides lightweight legal navigation and emergency guidance", () => {
    render(<SiteFooter />);

    expect(screen.getByRole("link", { name: "About" }).getAttribute("href")).toBe(
      "/about",
    );
    expect(screen.getByRole("link", { name: "Privacy" }).getAttribute("href")).toBe(
      "/privacy",
    );
    expect(screen.getByRole("link", { name: "Terms" }).getAttribute("href")).toBe(
      "/terms",
    );
    expect(
      screen.getByRole("link", { name: "Data Sources & Disclaimer" }).getAttribute("href"),
    ).toBe("/data-sources");
    expect(screen.getByText(/Independent service using official Cyprus pharmacy data/)).toBeTruthy();
    expect(screen.getByText(/not an emergency service/)).toBeTruthy();
    expect(screen.getByRole("link", { name: CONTACT_EMAIL }).getAttribute("href")).toBe(
      `mailto:${CONTACT_EMAIL}`,
    );
  });
});
