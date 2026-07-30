import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

// GitHub Pages project sites live at /<repo>/ (e.g. /starlanes/).
// The deploy workflow sets BASE_PATH=/starlanes/ (or the repo name).
export default defineConfig({
  base: process.env.BASE_PATH || "/",
  plugins: [
    VitePWA({
      registerType: "autoUpdate",
      devOptions: {
        enabled: true,
      },
      includeAssets: [
        "favicon.ico",
        "nova/sprites/**/*.png",
        "nova/picts/**/*.png",
        "nova/sounds/**/*.wav",
        "nova/*.json",
        "nova/music.mp3",
      ],
      manifest: {
        name: "Starlanes",
        short_name: "Starlanes",
        description:
          "Browser reimplementation of Escape Velocity Nova — inertial 2D space trading and combat",
        theme_color: "#000000",
        background_color: "#000000",
        display: "fullscreen",
        display_override: ["fullscreen", "standalone"],
        orientation: "landscape",
        scope: "/",
        start_url: "/",
        icons: [
          {
            src: "pwa-192x192.png",
            sizes: "192x192",
            type: "image/png",
          },
          {
            src: "pwa-512x512.png",
            sizes: "512x512",
            type: "image/png",
          },
          {
            src: "pwa-512x512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "any maskable",
          },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,ico,png,svg,wav,json}"],
        maximumFileSizeToCacheInBytes: 10 * 1024 * 1024, // allow large music + galaxy data
        runtimeCaching: [
          {
            urlPattern: /\/nova\/music\.mp3$/,
            handler: "CacheFirst",
            options: {
              cacheName: "starlanes-music",
              expiration: {
                maxEntries: 1,
                maxAgeSeconds: 60 * 60 * 24 * 30,
              },
            },
          },
          {
            urlPattern: /^https:\/\/fonts\./,
            handler: "CacheFirst",
            options: {
              cacheName: "google-fonts",
              expiration: {
                maxEntries: 10,
                maxAgeSeconds: 60 * 60 * 24 * 365,
              },
            },
          },
        ],
      },
    }),
  ],
});
