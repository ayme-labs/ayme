import { defineConfig, devices } from "@playwright/test";

/**
 * The lab app's Page Object qualification, against the running lab app. Run
 * by `lab:qualify`.
 */
export default defineConfig({
  testDir: "./tests",
  testMatch: "*.qualify.ts",
  fullyParallel: false,
  // Each test starts an Ayme MCP server the page pairs with by itself, which
  // it does only while exactly one runs.
  workers: 1,
  retries: 0,
  // Turbopack compiles each page on its first request, which can take a minute.
  timeout: 300_000,
  expect: { timeout: 60_000 },
  reporter: "list",
  use: {
    ...devices["Desktop Chrome"],
    // Chrome's own document.modelContext needs its feature flag. See WEBMCP
    // in tests/page-objects.qualify.ts.
    launchOptions: { args: ["--enable-features=WebMCP"] },
    // What the init script of `ayme mcp` needs of the browser, as the guide to
    // Page Objects on a page without Ayme sets it up: Formbricks's content
    // security policy allows neither the served modules nor the server's
    // loopback WebSocket.
    bypassCSP: true,
    permissions: ["local-network-access"],
    baseURL: "http://localhost:3000",
    trace: "retain-on-failure",
  },
});
