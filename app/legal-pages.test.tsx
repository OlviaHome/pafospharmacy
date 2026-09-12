// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LocalizedContentPage } from "@/components/localized-content-page";
import { SiteFooter } from "@/components/site-footer";
import { CONTACT_EMAIL } from "@/lib/content/site";
import { ar } from "@/lib/i18n/locales/ar";
import { el } from "@/lib/i18n/locales/el";
import { en } from "@/lib/i18n/locales/en";
import { ru } from "@/lib/i18n/locales/ru";

vi.mock("next/navigation", () => ({
  usePathname: () => "/en/about",
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: vi.fn() }),
}));

const dictionaries = [en, el, ru, ar] as const;

afterEach(cleanup);

describe("localized legal and information pages", () => {
  for (const dictionary of dictionaries) {
    for (const pageName of ["about", "privacy", "terms", "dataSources"] as const) {
      it(`renders ${dictionary.locale}/${pageName}`, () => {
        const page = dictionary.pages[pageName];
        render(
          <LocalizedContentPage
            locale={dictionary.locale}
            dictionary={dictionary}
            page={page}
          />,
        );

        expect(screen.getByRole("heading", { level: 1, name: page.title })).toBeTruthy();
        expect(screen.getByText(page.introduction)).toBeTruthy();
        expect(
          screen.getByRole("link", { name: dictionary.backToFinder }).getAttribute("href"),
        ).toBe(`/${dictionary.locale}`);
      });
    }
  }

  it("documents the strictly necessary language cookie without adding tracking", () => {
    render(
      <LocalizedContentPage locale="en" dictionary={en} page={en.pages.privacy} />,
    );

    expect(document.body.textContent).toContain(
      "strictly necessary cookie named “paphos_locale”",
    );
    expect(screen.getByText(/Apart from the necessary language-preference cookie/)).toBeTruthy();
    expect(screen.getByText(/does not run advertising or product analytics/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Geoapify" }).getAttribute("href")).toBe(
      "https://www.geoapify.com/privacy-policy/",
    );
  });

  it("localizes the Google privacy-policy label while preserving its URL", () => {
    render(
      <LocalizedContentPage locale="ar" dictionary={ar} page={ar.pages.privacy} />,
    );

    expect(
      screen
        .getByRole("link", { name: ar.googlePrivacyPolicyLabel })
        .getAttribute("href"),
    ).toBe("https://policies.google.com/privacy");
  });

  it("keeps the approved contact, emergency link, and localized footer routes", () => {
    render(<SiteFooter locale="ar" messages={ar.footer} />);

    expect(screen.getByRole("link", { name: CONTACT_EMAIL }).getAttribute("href")).toBe(
      `mailto:${CONTACT_EMAIL}`,
    );
    expect(screen.getByRole("link", { name: "112" }).getAttribute("href")).toBe("tel:112");
    expect(screen.getByRole("link", { name: ar.footer.about }).getAttribute("href")).toBe(
      "/ar/about",
    );
    expect(
      screen.getByRole("link", { name: ar.footer.dataSources }).getAttribute("href"),
    ).toBe("/ar/data-sources");
  });
});
