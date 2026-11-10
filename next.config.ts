import type { NextConfig } from "next";

const LEGACY_HOST = "pafospharmacy.vercel.app";
const PRODUCTION_ORIGIN = "https://healthguide.cy";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  images: {
    // Blog images live in the public Supabase Storage bucket "blog-images".
    remotePatterns: [
      {
        protocol: "https",
        hostname: "*.supabase.co",
        pathname: "/storage/v1/object/public/blog-images/**",
      },
      // Unsplash photos are hotlinked (required by its API) and rendered unoptimized.
      { protocol: "https", hostname: "images.unsplash.com" },
    ],
  },
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
