import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
  // The dep optimizer cannot rewrite maplibre's web-worker chunk; excluding it
  // keeps the worker loadable in dev (production builds are unaffected).
  optimizeDeps: {
    exclude: ["maplibre-gl"],
  },
});
