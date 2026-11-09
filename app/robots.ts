import type { MetadataRoute } from "next";

import { metadataBase } from "@/lib/i18n/metadata";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: "/api/",
    },
    sitemap: new URL("/sitemap.xml", metadataBase).toString(),
    host: metadataBase.origin,
  };
}
