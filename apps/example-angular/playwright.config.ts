import { createServer, type AddressInfo } from "node:net";
import { defineConfig } from "@playwright/test";

// ponytail: the port is released before the server binds it, so another
//   process could take it in between; both servers then fail loudly.
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
  (process.env.AYME_E2E_PORT_ANGULAR ??= String(await freePort()))
);
export const baseURL = `http://127.0.0.1:${port}`;
// The suite runs against the default SSR build, or with
// AYME_ANGULAR_RENDER=spa against the spa build configuration.
export const render = process.env.AYME_ANGULAR_RENDER === "spa" ? "spa" : "ssr";

export default defineConfig({
  testDir: "./tests",
  metadata: { render, server: "development" },
  outputDir: `test-results/${render}-development`,
  workers: 1,
  timeout: 60_000,
  reporter: "list",
  use: {
    baseURL,
    browserName: "chromium",
    trace: "retain-on-failure",
  },
  webServer: {
    command: `pnpm exec ng serve --host 127.0.0.1 --port ${port}${render === "spa" ? " --configuration spa" : ""}`,
    url: baseURL,
    stdout: "pipe",
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
