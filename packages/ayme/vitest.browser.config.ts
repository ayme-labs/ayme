import { playwright } from "@vitest/browser-playwright";
import { defineConfig, type Plugin } from "vitest/config";

const chromium = (args: string[] = []) => ({
  enabled: true,
  headless: true,
  instances: [{ browser: "chromium" as const }],
  provider: playwright({ launchOptions: { args } }),
});

// Pages a test can start a full load to without leaving the test document:
// a 204 drops the load, and `/__redirect` redirects to it.
const noContent: Plugin = {
  name: "no-content",
  configureServer(server) {
    server.middlewares.use("/__no-content", (_req, res) => {
      res.statusCode = 204;
      res.end();
    });
    server.middlewares.use("/__redirect", (_req, res) => {
      res.statusCode = 303;
      res.setHeader("Location", "/__no-content");
      res.end();
    });
  },
};

export default defineConfig({
  test: {
    projects: [
      {
        plugins: [noContent],
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
