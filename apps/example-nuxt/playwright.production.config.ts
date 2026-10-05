import { defineConfig } from "@playwright/test";
import config, { baseURL, port } from "./playwright.config";

export default defineConfig({
  ...config,
  testIgnore: "**/inspector.spec.ts",
  metadata: { server: "production" },
  outputDir: "test-results/production",
  webServer: {
    command: "pnpm run start",
    env: { HOST: "127.0.0.1", PORT: String(port) },
    url: baseURL,
    stdout: "pipe",
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
