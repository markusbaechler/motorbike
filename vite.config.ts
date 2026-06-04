import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

// Relative base so the app works both at the domain root and in a
// GitHub Pages subpath (e.g. https://<user>.github.io/motorbike/).
export default defineConfig({
  base: "./",
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["favicon.svg"],
      manifest: {
        name: "Motorbike – Routenplaner",
        short_name: "Motorbike",
        description:
          "Plane kurvige Motorradrouten, entdecke Sehenswürdigkeiten und finde Übernachtungen.",
        theme_color: "#0f172a",
        background_color: "#0f172a",
        display: "standalone",
        orientation: "portrait",
        start_url: "./",
        scope: "./",
        icons: [
          {
            src: "icon.svg",
            sizes: "any",
            type: "image/svg+xml",
            purpose: "any maskable",
          },
        ],
      },
      workbox: {
        // Don't precache map tiles / API responses (handled at runtime later).
        globPatterns: ["**/*.{js,css,html,svg,woff2}"],
      },
    }),
  ],
});
