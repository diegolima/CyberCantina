import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "prompt",
      injectRegister: false,
      includeAssets: ["icons/favicon.svg", "icons/apple-touch-icon.png"],
      manifest: {
        name: "CyberCantina — Agentic AI Roleplay Studio",
        short_name: "CyberCantina",
        description:
          "Agentic AI roleplay studio with multi-character cognition, CARE affective engine, and spatial world simulation.",
        start_url: "/",
        scope: "/",
        display: "standalone",
        background_color: "#0b0e14",
        theme_color: "#0b0e14",
        orientation: "any",
        icons: [
          {
            src: "/icons/icon-192.png",
            sizes: "192x192",
            type: "image/png",
            purpose: "any",
          },
          {
            src: "/icons/icon-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "any",
          },
          {
            src: "/icons/icon-512-maskable.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,png,woff2}"],
        globIgnores: ["**/webgpu.worker-*.js"],
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
        cleanupOutdatedCaches: true,
        navigateFallback: "/index.html",
        navigateFallbackDenylist: [/^\/api\//, /^\/docs/, /^\/openapi\.json$/],
      },
      devOptions: {
        enabled: false,
      },
    }),
  ],
  test: {
    include: ["src/**/*.test.{ts,tsx}"],
    exclude: ["e2e/**", "node_modules/**", "dist/**"],
  },
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:8000",
        changeOrigin: true,
        ws: true,
      },
    },
  },
});
