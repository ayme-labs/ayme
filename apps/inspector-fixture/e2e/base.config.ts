import path from "node:path";
import { fileURLToPath } from "node:url";
import { web } from "@e2e-dev/web";
import type { E2EConfig } from "e2e";

export const engine = web();

/**
 * The fixture dev server, started by hand:
 * `pnpm --filter @ayme-dev/inspector-fixture dev -- --port 4691 --strictPort`.
 */
export const APP_URL = process.env.AYME_E2E_APP_URL ?? "http://127.0.0.1:4691";

const here = (relative: string) =>
  fileURLToPath(new URL(relative, import.meta.url));

/**
 * The Inspector's Page Object as the dogfood page registers it: the fixture's
 * subclass, which finds the panel in its open shadow root with plain CSS. The
 * entry file in `packages/inspector` (`INSPECTOR_POM_ENTRY_FILE`) has the same
 * manifest, but its default container goes through the `ayme-inspector`
 * selector engine, which the web engine's own Playwright never registers.
 */
export const INSPECTOR_POM_FILE = here("../pom/Inspector.ts");
export const INSPECTOR_POM_ENTRY_FILE = here(
  "../../../packages/inspector/src/testing/pom/Inspector.ts"
);
export const LIST_POM_FILE = here("../pom/ListPage.ts");
export const POM_FILES = [INSPECTOR_POM_FILE, LIST_POM_FILE];

/**
 * Where e2e keeps its cache for one config and, beside it, the Ayme page
 * object call store. e2e resolves `cache.dir` against the config's directory,
 * so both land under `apps/inspector-fixture/e2e/.e2e/`.
 */
export function dirs(name: string) {
  return {
    cache: `.e2e/cache-${name}`,
    ayme: path.resolve(here("."), `.e2e/ayme/${name}`),
  };
}

/** The cache mode for e2e's cache and the Ayme store alike. */
export function cacheMode(): "read-write" | "read-only" {
  return process.env.AYME_E2E_CACHE === "read-only"
    ? "read-only"
    : "read-write";
}

export function config(
  name: string,
  agent: NonNullable<E2EConfig["agents"]>[string]
): E2EConfig {
  return {
    projectId: "dev.ayme.e2e.inspector",
    tests: process.env.AYME_E2E_TESTS ?? "tests/**/*.e2e.ts",
    targets: [
      {
        name: "web",
        engine,
        app: { url: APP_URL, identity: "ayme/inspector-fixture" },
      },
    ],
    // The first load of /dogfood.html compiles the Inspector's Page Object
    // from source, which takes the dev server a while.
    timeout: 180_000,
    workers: 1,
    cache: {
      dir: dirs(name).cache,
      mode: cacheMode(),
    },
    agents: { default: agent },
  };
}
