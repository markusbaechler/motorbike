import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

// Relative base so the app works both at the domain root and in a
// GitHub Pages subpath (e.g. https://<user>.github.io/motorbike/).
export default defineConfig({
  base: "./",
  build: {
    rollupOptions: {
      output: {
        // Split heavy vendors into their own chunks so they cache independently
        // and download in parallel (better repeat-visit performance).
        manualChunks: {
          maplibre: ["maplibre-gl"],
          qrcode: ["qrcode"],
        },
      },
    },
  },
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["favicon.svg", "apple-touch-icon.png", "logo.png"],
      manifest: {
        name: "Pudgilly Riders – Routenplaner",
        short_name: "Routenplaner",
        description:
          "Kurvige Motorradtouren planen: Tag für Tag, mit Pässen, Übernachtungen und GPX fürs Navi.",
        lang: "de-CH",
        theme_color: "#100f12",
        background_color: "#100f12",
        display: "standalone",
        // Relative on purpose: the same build runs under pudgilly.ch/planer/,
        // on GitHub Pages and on a subdomain without any change.
        start_url: "./",
        scope: "./",
        icons: [
          { src: "pwa-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
          { src: "pwa-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
          { src: "maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        // Precache app shell + icons; map tiles / APIs stay network.
        globPatterns: ["**/*.{js,css,html,svg,woff2,png}"],
        globIgnores: ["**/hero.jpg"],
        // Map data you have viewed stays available offline (cache-first).
        runtimeCaching: [
          {
            urlPattern: ({ url }: { url: URL }) => url.hostname.endsWith("openfreemap.org"),
            handler: "CacheFirst",
            options: {
              cacheName: "map-openfreemap",
              expiration: { maxEntries: 4000, maxAgeSeconds: 60 * 60 * 24 * 60 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            urlPattern: ({ url }: { url: URL }) =>
              url.hostname.includes("fonts.googleapis.com") ||
              url.hostname.includes("fonts.gstatic.com"),
            handler: "CacheFirst",
            options: {
              cacheName: "google-fonts",
              expiration: { maxEntries: 30, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
});
