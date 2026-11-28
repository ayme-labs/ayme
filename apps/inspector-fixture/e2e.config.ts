import { web } from "@e2e-dev/web";
import type { E2EConfig } from "e2e";

export default {
  tests: "tests/**/*.e2e.ts",
  // As the Playwright config: no retries, in CI too.
  retries: 0,
  // Playwright's default; e2e's is 120 s.
  timeout: 30_000,
  reporters: ["list"],
  trace: "retain-on-failure",
  targets: [
    {
      name: "chromium",
      // The panel's reduced motion only fades, so a box read after a change
      // is where it ends.
      engine: web({ reducedMotion: "reduce" }),
      app: {
        url: "http://127.0.0.1:0",
        // Serves every fixture page; /unpublished.html has publication off.
        command: {
          executable: "pnpm",
          args: [
            "exec",
            "vite",
            "--config",
            "app/vite.config.ts",
            "--port",
            "{port}",
            "--strictPort",
          ],
          log: ".e2e/logs/app.log",
        },
      },
    },
  ],
} satisfies E2EConfig;
