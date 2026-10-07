import { playwright } from "@vitest/browser-playwright";
import { defineConfig, type Plugin } from "vitest/config";

// @ayme-dev/ayme loads the Inspector and the Agent Connection by dynamic
// import, and its built entry is bundled for the browser here. These tests
// never load them (the options that would are mocked off), and the packages
// may not be built where they run, so they resolve to an empty module.
const optionalPeers: Plugin = {
  name: "optional-ayme-peers",
  enforce: "pre",
  resolveId(id) {
    if (id === "@ayme-dev/inspector" || id === "@ayme-dev/mcp/client")
      return "\0optional-ayme-peer";
  },
  load(id) {
    if (id === "\0optional-ayme-peer") return "export {};";
  },
};

export default defineConfig({
  plugins: [optionalPeers],
  // Prebundle React up front. Discovered mid-run, it is optimized again and
  // loads a second copy.
  optimizeDeps: { include: ["react", "react-dom/client"] },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: "server",
          environment: "node",
          include: ["src/**/*.test.ts"],
          exclude: ["src/**/*.browser.test.ts"],
        },
      },
      {
        // Client tests mount the owner and consumers in Chromium.
        extends: true,
        test: {
          name: "client",
          include: ["src/**/*.browser.test.ts"],
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
