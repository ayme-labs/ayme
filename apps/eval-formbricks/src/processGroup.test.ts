import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, describe, expect, it } from "vitest";

import { spawnProcessGroup, type ProcessGroup } from "./processGroup.ts";

const processGroupModule = fileURLToPath(
  new URL("./processGroup.ts", import.meta.url)
);

/**
 * Whether the process still runs. One that has ended but that its new
 * parent has yet to reap still takes a signal, so on Linux its state is
 * read too: an init that reaps late leaves it a zombie for a moment.
 */
function isAlive(pid: number) {
  try {
    process.kill(pid, 0);
  } catch {
    return false;
  }
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
    return (
      stat.slice(stat.lastIndexOf(")") + 2, stat.lastIndexOf(")") + 3) !== "Z"
    );
  } catch {
    return true;
  }
}

/**
 * Stopping a server with what it started, against stand-ins for `ayme mcp`:
 * Node scripts that start a child of their own which inherits their standard
 * error, as the server's esbuild service does, and say its process id there.
 */
describe("a process group the harness started", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "ayme-eval-group-"));
  const leftBehind: number[] = [];
  afterAll(() => {
    for (const pid of leftBehind)
      if (isAlive(pid)) process.kill(pid, "SIGKILL");
    rmSync(directory, { recursive: true, force: true });
  });

  /** A stand-in server: `body` runs with `child`, the child it started, in scope. */
  function standIn(
    name: string,
    options: { childDetached: boolean; body?: string }
  ) {
    const script = path.join(directory, `${name}.cjs`);
    writeFileSync(
      script,
      `const { spawn } = require("node:child_process");
// Stays alive whatever happens to this process, holding its standard error.
const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
  stdio: ["ignore", "ignore", "inherit"],
  detached: ${JSON.stringify(options.childDetached)},
});
process.stderr.write(\`child \${child.pid}\\n\`);
${options.body ?? ""}
setInterval(() => {}, 1000);
`
    );
    return script;
  }

  async function start(script: string) {
    const group = spawnProcessGroup(process.execPath, [script], {
      cwd: directory,
      env: process.env,
      termGraceMs: 300,
      closeGraceMs: 300,
    });
    let stderr = "";
    group.child.stderr!.on("data", (chunk) => (stderr += String(chunk)));
    await expect.poll(() => stderr).toMatch(/child \d+\n/);
    const childPid = Number(/child (\d+)/.exec(stderr)![1]);
    leftBehind.push(childPid);
    return { group, childPid };
  }

  function exitOf(group: ProcessGroup) {
    return new Promise<NodeJS.Signals | null>((resolve) => {
      if (group.child.signalCode !== null || group.child.exitCode !== null)
        resolve(group.child.signalCode);
      else group.child.once("exit", (_code, signal) => resolve(signal));
    });
  }

  it("ends with the child it started, which would otherwise keep its standard error open", async () => {
    const { group, childPid } = await start(
      standIn("server", { childDetached: false })
    );
    expect(isAlive(childPid)).toBe(true);

    expect(await group.stop()).toEqual({ stdioHeldOpen: false });

    expect(await exitOf(group)).toBe("SIGTERM");
    await expect.poll(() => isAlive(childPid)).toBe(false);
    expect(group.child.stderr!.destroyed).toBe(true);
  });

  it("is killed when it ignores SIGTERM", async () => {
    const { group, childPid } = await start(
      standIn("stubborn", {
        childDetached: false,
        body: 'process.on("SIGTERM", () => {});',
      })
    );

    expect(await group.stop()).toEqual({ stdioHeldOpen: false });

    expect(await exitOf(group)).toBe("SIGKILL");
    await expect.poll(() => isAlive(childPid)).toBe(false);
  });

  it("lets go of its stdio when a process that left the group still holds it, and says so", async () => {
    const { group, childPid } = await start(
      standIn("escaped", { childDetached: true })
    );

    expect(await group.stop()).toEqual({ stdioHeldOpen: true });

    // Out of the group's reach, so still there; the harness's end of the pipe is not.
    expect(isAlive(childPid)).toBe(true);
    expect(group.child.stderr!.destroyed).toBe(true);
    expect(await exitOf(group)).toBe("SIGTERM");
  });

  it("stops at once when the server has ended by itself", async () => {
    const group = spawnProcessGroup(process.execPath, ["-e", ""], {
      cwd: directory,
      env: process.env,
    });
    await new Promise((resolve) => group.child.once("close", resolve));

    const started = Date.now();
    expect(await group.stop()).toEqual({ stdioHeldOpen: false });
    expect(Date.now() - started).toBeLessThan(1_000);
  });

  it("is killed with the harness when the harness ends without stopping it", async () => {
    const harness = path.join(directory, "harness.mjs");
    writeFileSync(
      harness,
      `import { spawnProcessGroup } from ${JSON.stringify(processGroupModule)};
const group = spawnProcessGroup(process.execPath, [${JSON.stringify(standIn("abandoned", { childDetached: false }))}], { cwd: process.cwd(), env: process.env });
group.child.stderr.once("data", (chunk) => {
  process.stdout.write(\`server \${group.child.pid} \${chunk}\`);
  process.exit(0);
});
`
    );
    const run = spawnProcessGroup(process.execPath, [harness], {
      cwd: directory,
      env: process.env,
    });
    let stdout = "";
    run.child.stdout!.on("data", (chunk) => (stdout += String(chunk)));
    await new Promise((resolve) => run.child.once("exit", resolve));
    const [, server, child] = /server (\d+) child (\d+)/.exec(stdout)!;
    leftBehind.push(Number(server), Number(child));

    await expect.poll(() => isAlive(Number(server))).toBe(false);
    await expect.poll(() => isAlive(Number(child))).toBe(false);
    await run.stop();
  });
});
