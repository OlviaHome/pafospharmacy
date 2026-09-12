import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import {
  isLocale,
  localePath,
  LOCALE_COOKIE_NAME,
  preferredLocale,
} from "@/lib/i18n/config";

export function proxy(request: NextRequest) {
  const firstSegment = request.nextUrl.pathname.split("/")[1];
  if (isLocale(firstSegment)) return NextResponse.next();

  const locale = preferredLocale(
    request.cookies.get(LOCALE_COOKIE_NAME)?.value,
    request.headers.get("accept-language"),
  );
  const url = request.nextUrl.clone();
  url.pathname = localePath(locale, request.nextUrl.pathname);
  return NextResponse.redirect(url);
}

export const config = {
  matcher: [
    "/((?!api|_next/static|_next/image|favicon.ico|icon.svg|og.png|manifest.webmanifest|.*\\..*).*)",
  ],
};
