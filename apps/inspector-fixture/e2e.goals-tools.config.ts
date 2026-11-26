import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  assertOwnCacheDir,
  assertPatchedE2e,
  importBaseline,
  PAGE_OBJECT_RULES,
} from "@ayme-dev/e2e-tools";
import { claudeCode } from "@e2e-dev/acp";
import type { E2EConfig, JsonValue } from "e2e";

import base from "./e2e.config";
import { goalCalls } from "./tests/e2e/tools/goalCalls";
import { servedTools } from "./tests/e2e/tools/pageObjects";
import { scriptedExecutor } from "./tests/e2e/tools/scripted";

// The Page Object study's third arm: the goal tests of the first
// (e2e.goals.config.ts, tests/goals/), the same files, run by the same agent
// and model, with the e2e suite's Page Objects as tools beside e2e's own
// action tools. e2e records each Page Object Tool call and replays it with
// no model. It needs the patched e2e, in this run only:
// `pnpm test:goals:tools` starts it with `e2e-patched`
// (packages/e2e-tools/README.md). `AYME_E2E_EXECUTOR=scripted` answers each
// goal with the calls tests/e2e/tools/goalCalls.ts names instead, to try the
// wiring with no model; its recordings are kept apart from the agent's.

await assertPatchedE2e("e2e.goals-tools.config.ts");
const { default: goals } = await importBaseline(
  () => import("./e2e.goals.config")
);

const here = path.dirname(fileURLToPath(import.meta.url));
const scripted = process.env.AYME_E2E_EXECUTOR === "scripted";
const cacheDir = scripted
  ? ".e2e/goals-tools-scripted-cache"
  : ".e2e/goals-tools-cache";
assertOwnCacheDir("e2e.goals-tools.config.ts", here, cacheDir, [base, goals]);
const replayOnly = process.env.AYME_E2E_CACHE === "read-only";
const served = servedTools(
  path.join(here, ".e2e/goals-tools/stale-page-objects")
);

// The ACP executor's `tools` option is the patched executor's (`patched.ts`
// in e2e-tools); the model is the first arm's.
const agentOptions = {
  model: "sonnet",
  system: PAGE_OBJECT_RULES,
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
