import type { PlaywrightTestConfig } from "@playwright/test";
import { certificationConfig } from "@ayme-dev/example-certification/config";

const certification = await certificationConfig({
  name: "vue",
  // `/` is the playground; the counter contract page is its `/counter` route.
  counterPath: "/counter",
  webServer: ({ port, server }) => ({
    // The production build is the `dist` that `pnpm run build` wrote.
    command: `pnpm exec vite${server === "dev" ? "" : " preview"} --host 127.0.0.1 --port ${port} --strictPort`,
  }),
});

export default {
  ...certification,
  testMatch: [
    "vue-webmcp.spec.ts",
    "agentConnection.spec.ts",
    "integration.spec.ts",
  ],
  // The suite warms the counter page and `/other`; the playground's own
  // tests need the playground warm too.
  globalSetup: [certification.globalSetup, "./tests/warmDevServer.ts"]
    .flat()
    .filter((setup) => setup !== undefined),
  snapshotPathTemplate: "{testDir}/{testFilePath}-snapshots/{arg}{ext}",
} satisfies PlaywrightTestConfig;
