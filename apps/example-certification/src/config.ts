import { createServer, type AddressInfo } from "node:net";
import { defineConfig, type PlaywrightTestConfig } from "@playwright/test";

/** The server a run tests: `AYME_E2E_SERVER=production` for the production build. */
export const server: "dev" | "production" =
  process.env.AYME_E2E_SERVER === "production" ? "production" : "dev";

/** The render mode a run tests: `AYME_E2E_RENDER=spa` for the SPA. */
export const render: "ssr" | "spa" =
  process.env.AYME_E2E_RENDER === "spa" ? "spa" : "ssr";

// ponytail: the port is released before the server binds it, so another
//   process could take it in between; servers given an explicit port then
//   fail loudly instead of silently serving the wrong app.
const freePort = () =>
  new Promise<number>((resolve) => {
    const listener = createServer().listen(0, "127.0.0.1", () => {
      const { port } = listener.address() as AddressInfo;
      listener.close(() => resolve(port));
    });
  });

export type ExampleServerCommand = {
  command: string;
  env?: Record<string, string>;
};

export type ExampleServer = {
  port: number;
  server: typeof server;
  render: typeof render;
};

/**
 * The Playwright config of an example app's certification, for the server
 * and render mode the run's environment selects. `webServer` returns the
 * command that serves the app on `port`; `baseURL` and the output folder
 * follow from the mode.
 */
export async function certificationConfig(app: {
  /** Names `AYME_E2E_PORT_<NAME>`, which keeps one port across Playwright's workers. */
  name: string;
  webServer: (target: ExampleServer) => ExampleServerCommand;
}): Promise<PlaywrightTestConfig> {
  // Written back to `process.env` so Playwright workers, which re-load the
  // config, resolve the same port.
  const portVariable = `AYME_E2E_PORT_${app.name.toUpperCase()}`;
  const port = Number((process.env[portVariable] ??= String(await freePort())));
  const baseURL = `http://127.0.0.1:${port}`;
  return defineConfig({
    testDir: "./tests",
    outputDir: `test-results/${render === "spa" ? "spa-" : ""}${server === "dev" ? "development" : "production"}`,
    workers: 1,
    timeout: 60_000,
    reporter: "list",
    use: {
      baseURL,
      trace: "retain-on-failure",
    },
    webServer: {
      ...app.webServer({ port, server, render }),
      url: baseURL,
      stdout: "pipe",
      timeout: 120_000,
    },
  });
}
