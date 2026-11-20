import { playwright } from "@vitest/browser-playwright";
import { defineConfig } from "vitest/config";

import { toolbarCss, windowCss } from "./windowCss.config.ts";

export default defineConfig({
  plugins: [windowCss(), toolbarCss()],
  // Prebundle the views' dependencies up front. Discovered mid-run, they
  // are optimized again and load a second React.
  optimizeDeps: {
    include: [
      "react",
      "react-dom",
      "react-dom/client",
      "lucide-react",
      "radix-ui",
      "@trpc/client",
    ],
  },
  test: {
    projects: [
      {
        // The plain rules, the build and the layout, in Node.
        extends: true,
        test: {
          name: "unit",
          environment: "node",
          include: ["src/**/*.test.{ts,tsx}"],
          exclude: ["src/**/*.browser.test.{ts,tsx}"],
        },
      },
      {
        // Component tests render the window and the toolbar in Chromium and
        // read them through the package's page objects on playwright-lite.
        extends: true,
        test: {
          name: "component",
          include: ["src/**/*.browser.test.{ts,tsx}"],
          browser: {
            enabled: true,
            headless: true,
            provider: playwright({
              contextOptions: { reducedMotion: "reduce" },
            }),
            instances: [{ browser: "chromium" }],
            viewport: { width: 1280, height: 800 },
          },
        },
      },
    ],
  },
});
