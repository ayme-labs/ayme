#!/usr/bin/env node
import { capture } from "./capture";
import { planOf } from "./plan";
import { readCommand } from "./readCommand";
import { inspectorScript, session } from "./session";

const plan = planOf(readCommand(process.argv.slice(2), process.env));
if (plan.kind === "print") {
  process[plan.stream].write(plan.text);
  process.exitCode = plan.exitCode;
} else if (plan.kind === "capture") {
  process.exitCode = await capture(plan.target);
} else if (plan.kind === "mcp") {
  // Loaded here alone, so no other command loads the MCP server.
  const { serveMcp } = await import("./mcp");
  await serveMcp(
    { projectDir: process.cwd(), name: plan.session },
    inspectorScript(import.meta.url)
  );
  // Once the Agent App closed the connection, nothing may keep it alive.
  process.exit(0);
} else if (plan.kind === "session process") {
  // Once its Session ended, nothing may keep the process alive: a handle
  // left open would leave a background process behind.
  process.exit(await session(plan));
} else {
  process.exitCode = await session(plan);
}
