import { defineConfig } from "@playwright/test";
import config, { baseURL, port } from "./playwright.config";

export default defineConfig({
  ...config,
  testIgnore: "**/incremental.spec.ts",
  outputDir: "test-results/production",
  webServer: {
    command: `pnpm exec next start --hostname 127.0.0.1 --port ${port}`,
    url: baseURL,
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
