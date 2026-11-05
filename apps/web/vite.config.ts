/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath, URL } from "node:url";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
/** Dev/preview proxy target for /api (incl. WebSocket). Override to point at a separate local backend. */
const apiTarget = process.env.RETFAST_API_PROXY ?? "http://localhost:8080";
const proxy = { "/api": { target: apiTarget, changeOrigin: true, ws: true } };

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "@tokens": fileURLToPath(new URL("../../packages/design-tokens/dist", import.meta.url)),
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    fs: { allow: [repoRoot] },
    proxy,
  },
  preview: { proxy },
  build: {
    sourcemap: false,
    chunkSizeWarningLimit: 1200,
  },
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    css: false,
    include: ["src/**/*.test.{ts,tsx}"],
    testTimeout: 15000,
  },
});
