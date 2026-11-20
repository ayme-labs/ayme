import { web } from "@e2e-dev/web";
import type { E2EConfig } from "e2e";

// The e2e (e2e.com) counterpart of `../config.ts`, for the examples whose
// certification runs through e2e. Both read the same environment, so an
// example's scripts select the mode the same way for either runner.

/** The server a run tests: `AYME_E2E_SERVER=production` for the production build. */
export const server: "dev" | "production" =
  process.env.AYME_E2E_SERVER === "production" ? "production" : "dev";

/** The render mode a run tests: `AYME_E2E_RENDER=spa` for the SPA. */
export const render: "ssr" | "spa" =
  process.env.AYME_E2E_RENDER === "spa" ? "spa" : "ssr";

/**
 * The path of the page that renders the counter: `/` unless the app's
 * `certificationConfig` names another with `counterPath`. Read when called,
 * because the config sets it and the config loads after this module.
 */
export const counterPath = () => process.env.AYME_E2E_COUNTER_PATH ?? "/";

export type ExampleServerCommand = {
  /** Run without a shell, from `PATH`. */
  executable: string;
  /** `{port}` stands for the port the run picks. */
  args: string[];
  env?: Record<string, string>;
};

/**
 * The e2e config of an example app's certification, for the server and
 * render mode the run's environment selects. `command` returns the command
 * that serves the app on `{port}`, a free port the run picks; the results
 * folder follows from the mode.
 */
export function certificationConfig(app: {
  /** The counter page's path, when it is not `/`. */
  counterPath?: string;
  command: (target: {
    server: typeof server;
    render: typeof render;
  }) => ExampleServerCommand;
}): E2EConfig {
  // Every worker imports the config again, so the variable reaches them.
  if (app.counterPath) process.env.AYME_E2E_COUNTER_PATH = app.counterPath;
  const mode = `${render === "spa" ? "spa-" : ""}${server === "dev" ? "development" : "production"}`;
  return {
    tests: "tests/**/*.e2e.ts",
    output: `.e2e/${mode}`,
    // As the Playwright config: one worker, no retries, in CI too.
    workers: 1,
    retries: 0,
    timeout: 60_000,
    reporters: ["list"],
    trace: "retain-on-failure",
    targets: [
      {
        name: server,
        engine: web(),
        app: {
          url: "http://127.0.0.1:0",
          command: {
            ...app.command({ server, render }),
            startupTimeout: 120_000,
            log: `.e2e/logs/app-${mode}.log`,
          },
        },
      },
    ],
  } satisfies E2EConfig;
}
