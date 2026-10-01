import { createServer, type AddressInfo } from "node:net";
import { defineConfig, devices } from "@playwright/test";

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
const unpublishedPort = Number(
  (process.env.AYME_E2E_PORT_INSPECTOR_UNPUBLISHED ??= String(await freePort()))
);
/** The fixture pages with WebMCP publication off. */
export const unpublishedBaseURL = `http://127.0.0.1:${unpublishedPort}`;

export default defineConfig({
  testDir: "./tests",
  reporter: "list",
  use: {
    ...devices["Desktop Chrome"],
    baseURL,
  },
  webServer: [
    {
      command: `pnpm exec vite --config tests/fixture/vite.config.ts --port ${port} --strictPort`,
      url: baseURL,
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      // The same pages with WebMCP publication off.
      command: `pnpm exec vite --config tests/fixture/vite.unpublished.config.ts --port ${unpublishedPort} --strictPort`,
      url: unpublishedBaseURL,
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
});
