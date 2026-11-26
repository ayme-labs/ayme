import { assertUnpatchedE2e } from "@ayme-dev/e2e-tools";
import { claudeCode } from "@e2e-dev/acp";
import { web } from "@e2e-dev/web";
import type { E2EConfig } from "e2e";

import base from "./e2e.config";

// The goal-driven tests (tests/goals/*.goal.ts): each user step is an
// `agent.act` goal, run by Claude Code on the machine's own login. CI has no
// model, so only `e2e run --config e2e.goals.config.ts` reaches these files;
// `test:e2e` runs e2e.config.ts, whose glob (`*.e2e.ts`) leaves them out.

// Arm 1 runs e2e as published: a run that patches it stops here.
assertUnpatchedE2e("e2e.goals.config.ts");

/** The fixture server; `AYME_GOALS_PORT` points at one already running. */
const port = process.env.AYME_GOALS_PORT ?? "5199";

export default {
  ...base,
  tests: "tests/goals/**/*.goal.ts",
  // A goal runs live for tens of seconds on a recording run.
  timeout: 300_000,
  // Apart from the default config's, so its recordings and reports stay
  // their own; .e2e/ is gitignored.
  output: ".e2e/goals",
  cache: { mode: "read-write", dir: ".e2e/goals-cache" },
  workers: 1,
  targets: [
    {
      name: "chromium",
      engine: web({ reducedMotion: "reduce" }),
      app: {
        url: `http://127.0.0.1:${port}`,
        // The cache keys by the app's origin unless told otherwise.
        identity: "inspector-fixture",
        permissions: { "clipboard-read": "grant", "clipboard-write": "grant" },
        command: {
          executable: "pnpm",
          args: [
            "exec",
            "vite",
            "--config",
            "app/vite.config.ts",
            "--port",
            "{port}",
            "--strictPort",
          ],
          log: ".e2e/logs/goals-app.log",
          // A warm server started beforehand is used as is.
          reuseExisting: true,
        },
      },
    },
  ],
  agents: { default: { executor: claudeCode({ model: "sonnet" }) } },
} satisfies E2EConfig;
