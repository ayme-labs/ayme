import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  assertOwnCacheDir,
  assertPatchedE2e,
  importBaseline,
} from "@ayme-dev/e2e-tools";
import { claudeCode } from "@e2e-dev/acp";
import type { E2EConfig, JsonValue } from "e2e";

import base from "./e2e.config";
import { baselineCaches } from "./tests/e2e/tools/baselines";
import { goalCalls } from "./tests/e2e/tools/goalCalls";
import { servedTools } from "./tests/e2e/tools/pageObjects";
import { PAGE_OBJECT_RULES } from "./tests/e2e/tools/rules";
import { scriptedExecutor } from "./tests/e2e/tools/scripted";

// The Page Object study's third arm: the first arm's goal tests and settings
// (e2e.goals.config.ts) with the e2e suite's Page Objects as tools beside
// e2e's own action tools, on the patched e2e (packages/e2e-tools/README.md).
// `AYME_E2E_EXECUTOR=scripted` answers each goal with the calls
// tests/e2e/tools/goalCalls.ts names instead, with no model, and keeps its
// recordings apart from the agent's.

await assertPatchedE2e("e2e.goals-tools.config.ts");
process.env.AYME_E2E_MCP_PORT ??= "9585"; // This arm's recordings were made on this port and replay only against that origin; set before the import below pins arm 1's.
const {
  default: goals,
  GOALS_MODEL,
  PANEL_RULES,
} = await importBaseline(() => import("./e2e.goals.config"));

const here = path.dirname(fileURLToPath(import.meta.url));
const scripted = process.env.AYME_E2E_EXECUTOR === "scripted";
const cacheDir = scripted
  ? ".e2e/goals-tools-scripted-cache"
  : ".e2e/goals-tools-cache";
assertOwnCacheDir(
  "e2e.goals-tools.config.ts",
  here,
  cacheDir,
  baselineCaches(base, goals)
);
const replayOnly = process.env.AYME_E2E_CACHE === "read-only";
const served = servedTools(
  path.join(here, ".e2e/goals-tools/stale-page-objects")
);

// The ACP executor's `tools` option is the patched executor's (`patched.ts`
// in e2e-tools); the model is the first arm's.
const agentOptions = {
  model: GOALS_MODEL,
  // The goals-only arm's rules, then this arm's own about its tools.
  system: `${PANEL_RULES}\n\n${PAGE_OBJECT_RULES}`,
  tools: served,
};

export default {
  ...goals,
  output: scripted ? ".e2e/goals-tools-scripted" : ".e2e/goals-tools",
  cache: {
    mode: replayOnly ? "read-only" : "read-write",
    dir: cacheDir,
  },
  agents: {
    default: {
      executor: scripted
        ? scriptedExecutor(
            served,
            ({ step, attempt }) => {
              const calls = goalCalls[step.instruction]?.(
                (step.params ?? {}) as Record<string, JsonValue>,
                { title: attempt.titlePath.at(-1) ?? "" }
              );
              return calls === undefined ? undefined : { calls };
            },
            replayOnly
          )
        : claudeCode(agentOptions),
    },
  },
} satisfies E2EConfig;
