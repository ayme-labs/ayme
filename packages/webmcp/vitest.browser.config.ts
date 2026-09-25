import { playwright } from "@vitest/browser-playwright";
import { defineConfig } from "vitest/config";

const chromium = (args: string[] = []) => ({
  enabled: true,
  headless: true,
  instances: [{ browser: "chromium" as const }],
  provider: playwright({ launchOptions: { args } }),
});

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "chromium",
          browser: chromium(),
          include: ["src/**/*.browser.test.ts"],
          exclude: ["src/**/*.native.browser.test.ts"],
        },
      },
      {
        // Chromium's own WebMCP implementation of document.modelContext.
        test: {
          name: "native-webmcp",
          browser: chromium(["--enable-features=WebMCP,WebMCPTesting"]),
          include: ["src/**/*.native.browser.test.ts"],
        },
      },
    ],
  },
});
