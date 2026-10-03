import { defineConfig } from "@playwright/test";
import config from "./playwright.production.config";

process.env.VITE_AYME_SSR = "off";

export default defineConfig({
  ...config,
  outputDir: "test-results/spa-production",
  webServer: { ...config.webServer, command: "pnpm run start:spa" },
});
