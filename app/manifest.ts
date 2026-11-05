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
        src: "/icon.svg",
        sizes: "any",
        type: "image/svg+xml",
      },
    ],
  };
}
