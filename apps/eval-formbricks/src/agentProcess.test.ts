import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { startAgentProcess } from "./agentProcess.ts";

const directory = await mkdtemp(path.join(os.tmpdir(), "agent-process-"));
afterAll(() => rm(directory, { recursive: true, force: true }));

/** An agent that starts a process ignoring SIGTERM, prints its id, and exits when its input ends. */
const agentWithStubbornChild = `
  const { spawn } = require("node:child_process");
  const child = spawn(process.execPath, ["-e", "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)"], { stdio: "ignore" });
  console.log(child.pid);
  process.stdin.on("end", () => process.exit(0)).resume();
`;

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
      const exit = await agent.finish(5_000);
      expect(exit.exitCode).toBe(0);
    } finally {
      agent.dispose();
    }
    const pid = Number(agent.lines[0]);
    expect(pid).toBeGreaterThan(0);
    await expect.poll(() => alive(pid), { timeout: 2_000 }).toBe(false);
  });
});
