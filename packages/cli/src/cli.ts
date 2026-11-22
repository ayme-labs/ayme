#!/usr/bin/env node
import { runInstall, runTrace } from "@ayme-dev/recorder";

import { codegen } from "./codegen";
import { planOf } from "./plan";
import { readCommand } from "./readCommand";

// What to do is decided in `planOf`; this only carries the plan out.
const plan = planOf(readCommand(process.argv.slice(2)));
const projectDir = process.cwd();
if (plan.kind === "print") {
  process[plan.stream].write(plan.text);
  process.exitCode = plan.exitCode;
} else if (plan.kind === "codegen") {
  process.exitCode = await codegen(plan.target);
} else if (plan.kind === "install") {
  process.exitCode = await runInstall({ projectDir, args: plan.args });
} else {
  process.exitCode = await runTrace({ projectDir, args: plan.args });
}
