import { fileURLToPath } from "node:url";

import { ayme } from "@ayme-dev/unplugin-ayme/vite";
import { defineConfig } from "vite";

/** One self-contained IIFE: the runtime, its lazily imported page client, and the Page Objects. */
export default defineConfig({
  plugins: [ayme({ include: true })],
  define: { "process.env.NODE_ENV": JSON.stringify("production") },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    minify: false,
    lib: {
      entry: fileURLToPath(new URL("src/inject.ts", import.meta.url)),
      formats: ["iife"],
      name: "AymeSpike",
      fileName: () => "ayme-inject.js",
    },
  },
});
