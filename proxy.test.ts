import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";

import { LOCALE_COOKIE_NAME } from "@/lib/i18n/config";

import { proxy } from "./proxy";

function request(
  pathname: string,
  options: { cookie?: string; acceptLanguage?: string } = {},
) {
  const headers = new Headers();
  if (options.cookie) headers.set("cookie", `${LOCALE_COOKIE_NAME}=${options.cookie}`);
  if (options.acceptLanguage) headers.set("accept-language", options.acceptLanguage);
  return new NextRequest(`https://pafospharmacy.vercel.app${pathname}`, { headers });
}

describe("locale routing proxy", () => {
  it("detects a supported browser language at the unprefixed root", () => {
    const response = proxy(request("/?filter=on-duty", { acceptLanguage: "el-CY,el;q=0.9,en;q=0.7" }));
    expect(response.headers.get("location")).toBe(
      "https://pafospharmacy.vercel.app/el?filter=on-duty",
    );
  });

  it("falls back to English for unsupported or missing preferences", () => {
    expect(proxy(request("/")).headers.get("location")).toBe(
      "https://pafospharmacy.vercel.app/en",
    );
    expect(
      proxy(request("/about", { acceptLanguage: "de-DE,de;q=0.9" })).headers.get("location"),
    ).toBe("https://pafospharmacy.vercel.app/en/about");
  });

  it("lets an explicit language preference override browser languages", () => {
    const response = proxy(
      request("/privacy", { cookie: "ar", acceptLanguage: "ru-RU,ru;q=0.9" }),
    );
    expect(response.headers.get("location")).toBe(
      "https://pafospharmacy.vercel.app/ar/privacy",
    );
  });

  it("does not redirect an already localized route", () => {
    const response = proxy(
      request("/ru/terms", { cookie: "ar", acceptLanguage: "en-US" }),
    );
    expect(response.headers.get("location")).toBeNull();
  });
});
