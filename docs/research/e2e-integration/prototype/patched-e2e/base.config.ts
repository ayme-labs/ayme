import { web } from "@e2e-dev/web";
import type { E2EConfig } from "e2e";

export const engine = web();

/** No model provider is configured: agent steps fail with MODEL_UNAVAILABLE until one is chosen. */
export const model = undefined;

/** The example-react dev server, started by hand on 4391, clear of the shared 3000 and the Peek thread's 4291. */
export const APP_URL = process.env.SPIKE_APP_URL ?? "http://127.0.0.1:4391";

export const COUNTER_POM_FILE = new URL(
  "../../../ayme-e2e-spike/apps/example-react/playwright/pom/CounterPage.ts",
  import.meta.url
).pathname;

export const POM_FILE = new URL(
  "../../../ayme-e2e-spike/apps/example-react/src/pom/ProjectsPage.ts",
  import.meta.url
).pathname;

export function config(
  name: string,
  agent: NonNullable<E2EConfig["agents"]>[string]
): E2EConfig {
  return {
    projectId: `dev.ayme.e2e-spike.${name}`,
    tests: process.env.SPIKE_TESTS ?? "tests/**/*.e2e.ts",
    targets: [
      {
        name: "web",
        engine,
        app: { url: APP_URL, identity: "ayme-spike/example-react" },
      },
    ],
    timeout: 180_000,
    workers: 1,
    cache: {
      dir: `.e2e/cache-${name}`,
      mode:
        process.env.SPIKE_CACHE_MODE === "read-only"
          ? "read-only"
          : "read-write",
    },
    agents: { default: agent },
  };
}
