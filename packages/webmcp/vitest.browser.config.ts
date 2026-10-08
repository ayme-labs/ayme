import { playwright } from "@vitest/browser-playwright";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Chromium's own WebMCP implementation of document.modelContext.
    name: "native-webmcp",
    include: ["src/**/*.browser.test.ts"],
    browser: {
      enabled: true,
      headless: true,
      instances: [{ browser: "chromium" }],
      provider: playwright({
        launchOptions: { args: ["--enable-features=WebMCP,WebMCPTesting"] },
      }),
    },
  },
});
