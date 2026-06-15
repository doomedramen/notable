import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: "autoUpdate",
      // Cache the app shell so the editor opens with no network.
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,png,woff2}"],
        navigateFallback: "/index.html",
        // Never cache API calls — sync logic owns that data path, and
        // plugin/theme code (served under /api/) must never go stale.
        navigateFallbackDenylist: [/^\/api\//],
      },
      manifest: {
        id: "/",
        name: "Notable",
        short_name: "Notable",
        description: "Self-hosted, offline-first notes",
        theme_color: "#1e1e2e",
        background_color: "#1e1e2e",
        display: "standalone",
        start_url: "/",
        scope: "/",
        lang: "en",
        icons: [
          { src: "/pwa-64x64.png", sizes: "64x64", type: "image/png" },
          { src: "/pwa-192x192.png", sizes: "192x192", type: "image/png" },
          { src: "/pwa-512x512.png", sizes: "512x512", type: "image/png" },
          {
            src: "/maskable-icon-512x512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
        shortcuts: [
          {
            name: "New note",
            short_name: "New note",
            description: "Create a new note",
            url: "/new",
            icons: [{ src: "/icon-192.png", sizes: "192x192", type: "image/png" }],
          },
        ],
        share_target: {
          action: "/share-target",
          method: "GET",
          params: { title: "title", text: "text", url: "url" },
        },
      },
    }),
  ],
  server: {
    proxy: {
      "/api": { target: "http://localhost:8080", ws: true },
    },
  },
});
