import { createHash } from "node:crypto";

import { assertUnpatchedE2e } from "@ayme-dev/e2e-tools";
import { claudeCode } from "@e2e-dev/acp";
import type { E2EConfig } from "e2e";

import base from "./e2e.config";

// The goal twins' own config: an agent for their goals, and the stable setup
// their recordings need to replay.

// Each goal runs a coding agent on a model through this machine's login, and
// CI has neither, so the goal files never run there.
if (process.env.CI)
  throw new Error(
    "e2e.goals.config.ts runs an agent on a model, and CI has none: run the goal tests on your own machine."
  );

// Arm 1 runs e2e as published: a run that patches it stops here.
assertUnpatchedE2e("e2e.goals.config.ts");

/** What the goals' agent is told, in every arm that runs these goals (e2e.goals-tools.config.ts adds its tools' rules). */
export const PANEL_RULES =
  "You are testing the ayme Inspector panel. Carry out each goal through the panel's controls, never by acting on the page under it.";

/** The goals' agent's model, in every arm that runs these goals, so a change moves them together. */
export const GOALS_MODEL = "sonnet";

// The external placement's Inspector window is served by `ayme mcp`, and a
// recording is keyed to the window's origin: one port for every test (they
// run one at a time) lets them replay. Derived from this checkout's path, so
// two checkouts' runs rarely meet; above the 9350-9365 range pages scan to
// pair (packages/mcp/testing/index.ts), so no page pairs with it unasked.
const checkout = createHash("sha256")
  .update(import.meta.dirname)
  .digest()
  .readUInt16BE(0);
process.env.AYME_E2E_MCP_PORT ??= String(9400 + (checkout % 400));

const [target] = base.targets;

export default {
  ...base,
  tests: "tests/goals/**/*.goal.ts",
  // A goal runs live for up to tens of seconds on a recording run, and one
  // test (each tool's page, in toolsLens) runs a goal per live tool.
  timeout: 900_000,
  // Apart from the default config's, so its reports stay their own; .e2e/
  // is gitignored. The cache's directory is pinned by `pnpm test:goals`.
  output: ".e2e/goals",
  // `AYME_E2E_CACHE=read-only` replays without writing, as arm 3's does.
  cache: {
    mode:
      process.env.AYME_E2E_CACHE === "read-only" ? "read-only" : "read-write",
  },
  workers: 1,
  targets: [
    {
      ...target,
      app: {
        ...target.app,
        // The cache keys by the app's origin unless told otherwise, and the
        // runner picks the app's port.
        identity: "inspector-fixture",
        command: { ...target.app.command, log: ".e2e/logs/goals-app.log" },
      },
    },
  ],
  agents: {
    default: {
      executor: claudeCode({
        model: GOALS_MODEL,
        system: PANEL_RULES,
      }),
    },
  },
} satisfies E2EConfig;
