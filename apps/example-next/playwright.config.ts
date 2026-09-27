import { createServer, type AddressInfo } from "node:net";
import { defineConfig } from "@playwright/test";

// ponytail: the port is released before the server binds it, so another
//   process could take it in between; an explicit `--port` makes Next fail
//   loudly (no retry) instead of silently hitting the wrong server.
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
  (process.env.AYME_E2E_PORT_NEXT ??= String(await freePort()))
);
export const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: "./tests",
  outputDir: "test-results/development",
  workers: 1,
  timeout: 60_000,
  reporter: "list",
  use: {
    baseURL,
    browserName: "chromium",
    trace: "retain-on-failure",
  },
  webServer: {
    command: `pnpm exec next dev --hostname 127.0.0.1 --port ${port}`,
    url: baseURL,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
