import { defineConfig } from "@playwright/test";
import config, { baseURL, port, render } from "./playwright.config";

export default defineConfig({
  ...config,
  metadata: { render, server: "production" },
  outputDir: `test-results/${render}-production`,
  webServer: {
    command: render === "spa" ? "pnpm run start:spa" : "pnpm run start",
    env: { HOST: "127.0.0.1", PORT: String(port) },
    url: baseURL,
    stdout: "pipe",
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
