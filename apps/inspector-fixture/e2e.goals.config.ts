import { createHash } from "node:crypto";

import { claudeCode } from "@e2e-dev/acp";
import type { E2EConfig } from "e2e";

import base from "./e2e.config";

// The goal twins' own config: their steps need a coding agent on this
// machine's login, which CI does not have, and replays that only a stable
// setup gives.

if (process.env.CI)
  throw new Error(
    "e2e.goals.config.ts runs an agent on a model, and CI has none: run the goal tests on your own machine."
  );

// The external placement's Inspector window is served by `ayme mcp`, and a
// recording is keyed to the window's origin: one port for every test (they
// run one at a time) lets them replay. Derived from this checkout's path, so
// two checkouts' runs don't meet; above the 9350-9365 range pages scan to
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
  cache: { mode: "read-write" },
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
        model: "sonnet",
        system:
          "You are testing the ayme Inspector panel. Carry out each goal through the panel's controls, never by acting on the page under it.",
      }),
    },
  },
} satisfies E2EConfig;
