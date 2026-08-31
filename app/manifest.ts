import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Paphos Pharmacy",
    short_name: "Pharmacy",
    description: "Find a pharmacy you can use now in Paphos.",
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
