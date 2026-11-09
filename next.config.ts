import type { NextConfig } from "next";

const LEGACY_HOST = "pafospharmacy.vercel.app";
const PRODUCTION_ORIGIN = "https://healthguide.cy";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  async redirects() {
    return [
      {
        // The site moved to healthguide.cy: send every legacy URL to the same path there.
        source: "/:path*",
        has: [{ type: "host", value: LEGACY_HOST }],
        destination: `${PRODUCTION_ORIGIN}/:path*`,
        permanent: true,
      },
    ];
  },
};

export default nextConfig;
