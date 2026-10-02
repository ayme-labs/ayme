import { defineConfig } from "@playwright/test";
import config from "./playwright.config";

// Read by the dev server, the build and the specs.
process.env.VITE_AYME_SSR = "off";

export default defineConfig({
  ...config,
  outputDir: "test-results/spa-development",
});
