import { createServer, type AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import { defineConfig, type PlaywrightTestConfig } from "@playwright/test";

/** The server a run tests: `AYME_E2E_SERVER=production` for the production build. */
export const server: "dev" | "production" =
  process.env.AYME_E2E_SERVER === "production" ? "production" : "dev";

/** The render mode a run tests: `AYME_E2E_RENDER=spa` for the SPA. */
export const render: "ssr" | "spa" =
  process.env.AYME_E2E_RENDER === "spa" ? "spa" : "ssr";

/**
 * The path of the page that renders the counter: `/` unless the app's
 * `certificationConfig` names another with `counterPath`, for an app whose
 * `/` is something else, such as a playground. Read when called, because the
 * config sets it and the config loads after this module.
 */
export const counterPath = () => process.env.AYME_E2E_COUNTER_PATH ?? "/";

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

/**
 * The port of the agent's Ayme MCP server that an example's App Process
 * looks for, in place of the auto-pair range. The example's server start
 * reads it from `AYME_EXAMPLE_AGENT_PORT`, which the run's `webServer`
 * passes, and the Agent Connection suite's App Process case starts its
 * agent there. A free port, so outside the range that pages and processes
 * of other runs scan. Written back to `process.env` so Playwright workers,
 * which re-load the config, resolve the same port.
 */
export const agentPort = Number(
  (process.env.AYME_EXAMPLE_AGENT_PORT ??= String(await freePort()))
);

/**
 * A free port other than `agentPort`. The system can hand out the agent's
 * port again once its listener closes; an example's App Process then probes
 * its own dev server, and Nuxt's dev server restarts when the probe hangs up
 * mid-answer, dropping Playwright's readiness check.
 */
async function freePortBesideAgent() {
  let port = await freePort();
  while (port === agentPort) port = await freePort();
  return port;
}

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
  /** The counter page's path, when it is not `/`. */
  counterPath?: string;
  webServer: (target: ExampleServer) => ExampleServerCommand;
}): Promise<PlaywrightTestConfig> {
  // Written back to `process.env` so Playwright workers, which re-load the
  // config, resolve the same port.
  const portVariable = `AYME_E2E_PORT_${app.name.toUpperCase()}`;
  const port = Number(
    (process.env[portVariable] ??= String(await freePortBesideAgent()))
  );
  const baseURL = `http://127.0.0.1:${port}`;
  if (app.counterPath) process.env.AYME_E2E_COUNTER_PATH = app.counterPath;
  return defineConfig({
    testDir: "./tests",
    globalSetup:
      server === "dev"
        ? fileURLToPath(new URL("./warmDevServer.ts", import.meta.url))
        : undefined,
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
