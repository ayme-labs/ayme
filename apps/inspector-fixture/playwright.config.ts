import { createServer, type AddressInfo } from "node:net";
import { defineConfig, devices } from "@playwright/test";

import type { Placement } from "./tests/fixtures";

// ponytail: the port is released before the server binds it, so another
//   process could take it in between; `--strictPort` makes that fail loudly
//   instead of silently hitting the wrong server.
const freePort = () =>
  new Promise<number>((resolve) => {
    const server = createServer().listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      server.close(() => resolve(port));
    });
  });

// Written back to `process.env` so Playwright workers, which re-load this
// config, resolve the same port.
export const port = Number(
  (process.env.AYME_E2E_PORT_INSPECTOR ??= String(await freePort()))
);
export const baseURL = `http://127.0.0.1:${port}`;

/** The specs that run in both placements, by what they check. */
const externalSpecs = [
  "detailRuns",
  "modelLens",
  "refPicking",
  "runs",
  "structure",
  "toolsLens",
].map((name) => `**/${name}.spec.ts`);

export default defineConfig<{ placement: Placement }>({
  testDir: "./tests",
  reporter: "list",
  use: {
    ...devices["Desktop Chrome"],
    baseURL,
    // The panel's reduced motion only fades, so a box read after a change is
    // where it ends. tests/motion.spec.ts runs with full motion.
    reducedMotion: "reduce",
  },
  projects: [
    // The Inspector mounted in the fixture page.
    { name: "inline" },
    {
      // The same specs with the Inspector in a window of its own, which
      // `ayme mcp` serves and relays to the fixture page (ADR-0049). Only the
      // specs about what the Inspector shows and does run here: the others
      // are about the panel in the page (its layout, its host's CSS, the
      // page state it adds), which the external placement has none of.
      name: "external",
      testMatch: externalSpecs,
      use: { placement: "external" },
    },
  ],
  webServer: {
    // Serves every fixture page; /unpublished.html has publication off.
    command: `pnpm exec vite --config app/vite.config.ts --port ${port} --strictPort`,
    url: baseURL,
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
