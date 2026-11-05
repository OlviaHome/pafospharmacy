import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Cyprus Pharmacy",
    short_name: "Pharmacy",
    description:
      "Find open and on-duty pharmacies across Cyprus using official pharmacy and duty data.",
    start_url: "/",
    display: "standalone",
    background_color: "#f1f1f1",
    theme_color: "#0f3d3e",
    icons: [
      {
        src: "/icon-192.png",
        sizes: "192x192",
        type: "image/png",
      },
      {
        src: "/icon-512.png",
        sizes: "512x512",
        type: "image/png",
      },
      {
        src: "/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
