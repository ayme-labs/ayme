import { defineConfig } from "@playwright/test";
import { agentPort } from "@ayme-dev/example-certification/config";
import config, { baseURL, port } from "./playwright.config";

export default defineConfig({
  ...config,
  testIgnore: "**/inspector.spec.ts",
  metadata: { server: "production" },
  outputDir: "test-results/production",
  webServer: {
    command: "pnpm run start",
    env: {
      HOST: "127.0.0.1",
      PORT: String(port),
      // The App Process stays off in production, whatever this says.
      AYME_EXAMPLE_AGENT_PORT: String(agentPort),
    },
    url: baseURL,
    stdout: "pipe",
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
