import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Prosper Hotel",
    short_name: "Prosper Hotel",
    description: "Stock, sales, and profit tracking for Prosper Hotel.",
    start_url: "/",
    display: "standalone",
    background_color: "#FAF9FB",
    theme_color: "#331642",
    icons: [
      {
        src: "/icon.png",
        sizes: "512x512",
        type: "image/png",
      },
      {
        src: "/icon-512-maskable.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
