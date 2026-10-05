import { fileURLToPath, URL } from "node:url";

import vue from "@vitejs/plugin-vue";
import { ayme } from "@ayme-dev/unplugin-ayme/vite";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // The compiler plugin registers the demo's POMs, as the application build
  // does.
  plugins: [vue(), ayme()],
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
