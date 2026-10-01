import { playwright } from "@vitest/browser-playwright";
import { defineConfig } from "vitest/config";

import { inspectorCss } from "./inspectorCss.config.ts";

export default defineConfig({
  plugins: [inspectorCss()],
  // Prebundle the panel's dependencies up front. Discovered mid-run, they
  // are optimized again and load a second React.
  optimizeDeps: {
    include: ["react", "react-dom/client", "lucide-react", "radix-ui"],
  },
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
            // A desktop viewport: the panel's layouts are sized for one.
            viewport: { width: 1280, height: 800 },
          },
        },
      },
    ],
  },
});
