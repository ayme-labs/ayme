// Throwaway vitest browser config for bullet 3's Lite check. Mirrors packages/ayme's chromium lane.
import { fileURLToPath } from "node:url";
import { playwright } from "../../packages/ayme/node_modules/@vitest/browser-playwright/dist/index.js";
import { defineConfig } from "../../packages/ayme/node_modules/vitest/dist/config.js";

const lite = fileURLToPath(new URL("../../packages/ayme/node_modules/@ayme-dev/playwright-lite/dist/index.mjs", import.meta.url));
export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  resolve: { alias: { "@ayme-dev/playwright-lite": lite } },
  server: { port: 63415, strictPort: true, fs: { allow: [fileURLToPath(new URL("../..", import.meta.url))] } },
  test: {
    include: ["lite.browser.test.ts"],
    browser: { enabled: true, headless: true, api: { port: 63415, strictPort: true }, instances: [{ browser: "chromium" }], provider: playwright() },
  },
});
