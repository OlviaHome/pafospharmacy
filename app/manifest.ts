import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Paphos Pharmacy",
    short_name: "Pharmacy",
    description:
      "Find open and on-duty pharmacies in Paphos using official Cyprus pharmacy and duty data.",
    start_url: "/",
    display: "standalone",
    background_color: "#f4f7f5",
    theme_color: "#08785f",
    icons: [
      {
        src: "/icon.svg",
        sizes: "any",
        type: "image/svg+xml",
      },
    ],
  };
}
