import { defineConfig } from "@playwright/test";

const mode = process.env["PROBE_MODE"] ?? "prod";
const port = Number(
  process.env["PROBE_PORT"] ?? (mode === "dev" ? 4321 : 4322)
);
export default defineConfig({
  testDir: "./tests",
  workers: 1,
  timeout: 60_000,
  reporter: "list",
  use: { baseURL: `http://127.0.0.1:${port}`, browserName: "chromium" },
  webServer: {
    command:
      mode === "dev"
        ? `npx ng serve --host 127.0.0.1 --port ${port}`
        : `PORT=${port} node dist/<app>/server/server.mjs`,
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: false,
    timeout: 180_000,
    stdout: "pipe",
  },
});
