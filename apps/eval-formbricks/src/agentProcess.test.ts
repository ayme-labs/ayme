import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { startAgentProcess } from "./agentProcess.ts";

const directory = await mkdtemp(path.join(os.tmpdir(), "agent-process-"));
afterAll(() => rm(directory, { recursive: true, force: true }));

/**
 * An agent that starts a process ignoring SIGTERM, prints its id once that
 * process says it is ignoring it, and exits when its input ends.
 */
const agentWithStubbornChild = `
  const { spawn } = require("node:child_process");
  const child = spawn(
    process.execPath,
    ["-e", "process.on('SIGTERM', () => {}); console.log('ready'); setInterval(() => {}, 1000)"],
    { stdio: ["ignore", "pipe", "ignore"] }
  );
  child.stdout.once("data", () => console.log(child.pid));
  process.stdin.on("end", () => process.exit(0)).resume();
`;

let stubbornChild: number | undefined;
// Whatever the test finds, its stubborn process does not stay.
afterAll(() => {
  if (stubbornChild !== undefined && alive(stubbornChild))
    process.kill(stubbornChild, "SIGKILL");
});

function alive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

describe("startAgentProcess", () => {
  it("leaves nothing of the agent's process group behind once the agent has exited", async () => {
    const agent = startAgentProcess({
      command: process.execPath,
      args: ["-e", agentWithStubbornChild],
      cwd: directory,
      environment: process.env,
      transcriptPath: path.join(directory, "transcript.jsonl"),
      stderrPath: path.join(directory, "stderr.log"),
      onLine: () => true,
    });
    try {
      await expect.poll(() => agent.lines.length, { timeout: 5_000 }).toBe(1);
      stubbornChild = Number(agent.lines[0]);
      const exit = await agent.finish(5_000);
      expect(exit.exitCode).toBe(0);
    } finally {
      agent.dispose();
    }
    expect(stubbornChild).toBeGreaterThan(0);
    await expect
      .poll(() => alive(stubbornChild ?? 0), { timeout: 2_000 })
      .toBe(false);
  });
});
