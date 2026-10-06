import path from "node:path";
import { web } from "@e2e-dev/web";
import type { E2EConfig } from "e2e";

export const engine = web();

/** The example-react dev server, started by hand on 4391, clear of the shared 3000 and the Peek thread's 4291. */
export const APP_URL = process.env.SPIKE_APP_URL ?? "http://127.0.0.1:4391";

const REACT_APP = new URL(
  "../../../../ayme-e2e-spike/apps/example-react/",
  import.meta.url
).pathname;
export const POM_FILE = path.join(REACT_APP, "src/pom/ProjectsPage.ts");
export const COUNTER_POM_FILE = path.join(
  REACT_APP,
  "playwright/pom/CounterPage.ts"
);

/** Where e2e keeps its cache for this config, and beside it, under `.e2e/ayme/`, the Ayme store. */
export function dirs(name: string) {
  return {
    cache: `.e2e/cache-${name}`,
    ayme: path.resolve(`.e2e/ayme/${name}`),
  };
}

export function config(
  name: string,
  agent: NonNullable<E2EConfig["agents"]>[string]
): E2EConfig {
  return {
    projectId: `dev.ayme.e2e-nofork.${name}`,
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
    cache: { dir: dirs(name).cache, mode: "read-write" },
    agents: { default: agent },
  };
}
