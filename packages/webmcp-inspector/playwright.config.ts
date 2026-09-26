import { defineConfig, devices } from "@playwright/test";

const baseURL = "http://127.0.0.1:4291";

export default defineConfig({
  testDir: "./tests",
  reporter: "list",
  use: {
    ...devices["Desktop Chrome"],
    baseURL,
    // Chromium's own WebMCP, with executeTool for tests.
    launchOptions: { args: ["--enable-features=WebMCP,WebMCPTesting"] },
  },
  webServer: {
    command: "pnpm exec vite --config tests/fixture/vite.config.ts",
    url: baseURL,
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
