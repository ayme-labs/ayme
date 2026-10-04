import { createServer, type AddressInfo } from "node:net";
import { defineConfig } from "@playwright/test";

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
  (process.env.AYME_E2E_PORT_VUE ??= String(await freePort()))
);
export const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: "./tests",
  testMatch: ["vue-webmcp.spec.ts", "agentConnection.spec.ts"],
  globalSetup: "./tests/warmDevServer.ts",
  workers: 1,
  reporter: "list",
  snapshotPathTemplate: "{testDir}/{testFilePath}-snapshots/{arg}{ext}",
  use: {
    baseURL,
  },
  webServer: {
    command: `pnpm exec vite --host 127.0.0.1 --port ${port} --strictPort`,
    url: baseURL,
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
