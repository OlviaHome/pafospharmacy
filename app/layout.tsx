import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";

import { SiteFooter } from "@/components/site-footer";

import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.SITE_URL ?? "http://localhost:3000"),
  title: "Paphos Pharmacy",
  description:
    "Find open and on-duty pharmacies in Paphos using official Cyprus pharmacy and duty data.",
  applicationName: "Paphos Pharmacy",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: "/icon.svg",
    apple: "/icon.svg",
  },
  openGraph: {
    title: "Paphos Pharmacy",
    description:
      "Find open and on-duty pharmacies in Paphos using official Cyprus pharmacy and duty data.",
    type: "website",
    images: [{ url: "/og.png", width: 1734, height: 907, alt: "Paphos Pharmacy" }],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#08785f",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <body>
        {children}
        <SiteFooter />
      </body>
    </html>
  );
}
