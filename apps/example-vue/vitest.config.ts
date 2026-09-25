import { fileURLToPath, URL } from "node:url";

import vue from "@vitejs/plugin-vue";
import { aymeWebMcp } from "@ayme-dev/unplugin-webmcp/vite";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // The compiler plugin registers the demo's POMs and enables publication,
  // as the application build does.
  plugins: [vue(), aymeWebMcp({ publish: true })],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.ts", "tests/**/*.test.ts"],
  },
});
