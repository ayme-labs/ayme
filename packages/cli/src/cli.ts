#!/usr/bin/env node
import { capture } from "./capture";
import { planOf } from "./plan";
import { readCommand } from "./readCommand";

const plan = planOf(readCommand(process.argv.slice(2)));
if (plan.kind === "print") {
  process[plan.stream].write(plan.text);
  process.exitCode = plan.exitCode;
} else {
  process.exitCode = await capture(plan.target);
}
