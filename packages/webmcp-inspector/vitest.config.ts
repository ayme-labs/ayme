import { playwright } from "@vitest/browser-playwright";
import { defineConfig } from "vitest/config";

import { inspectorCss } from "./inspectorCss.config.ts";

export default defineConfig({
  plugins: [inspectorCss()],
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          environment: "jsdom",
          include: ["src/**/*.test.{ts,tsx}"],
          exclude: ["src/**/*.browser.test.{ts,tsx}"],
        },
      },
      {
        // Component tests render one part of the panel in Chromium and drive
        // it through the Inspector's page objects on playwright-lite.
        extends: true,
        test: {
          name: "component",
          include: ["src/**/*.browser.test.{ts,tsx}"],
          browser: {
            enabled: true,
            headless: true,
            provider: playwright(),
            instances: [{ browser: "chromium" }],
          },
        },
      },
    ],
  },
});
