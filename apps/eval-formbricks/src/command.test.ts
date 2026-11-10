import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, describe, expect, it } from "vitest";

import { countedKinds, resourcesLeftOpen } from "./command.ts";

describe("what a command left open", () => {
  it("is every kind of resource beyond the ones it started with, as often as it is extra", () => {
    expect(
      resourcesLeftOpen(
        ["PipeWrap", "PipeWrap"],
        ["PipeWrap", "PipeWrap", "PipeWrap", "ProcessWrap", "Timeout"]
      )
    ).toEqual(["PipeWrap", "ProcessWrap", "Timeout"]);
  });

  it("is nothing when only its own output streams are open", () => {
    expect(resourcesLeftOpen(["TTYWrap", "TTYWrap"], ["TTYWrap"])).toEqual([]);
  });

  it("is named by kind, with a count", () => {
    expect(countedKinds(["PipeWrap", "Timeout", "PipeWrap"])).toBe(
      "2 PipeWrap, 1 Timeout"
    );
  });
});

/**
 * `runCommand` in a Node process of its own, as the commands run it, with a
 * grace of 300 ms: `main` is the body of the command's main function.
 */
describe("a command's end", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "ayme-eval-command-"));
  afterAll(() => rmSync(directory, { recursive: true, force: true }));
  const commandModule = fileURLToPath(new URL("./command.ts", import.meta.url));

  function run(name: string, main: string) {
    const script = path.join(directory, `${name}.mjs`);
    writeFileSync(
      script,
      `import net from "node:net";
import { runCommand } from ${JSON.stringify(commandModule)};
const log = (line) => process.stderr.write(\`\${line}\\n\`);
void runCommand(async () => {
${main}
}, log, 300);
`
    );
    const child = spawn(process.execPath, [script]);
    let stderr = "";
    child.stderr.on("data", (chunk) => (stderr += String(chunk)));
    const started = Date.now();
    return new Promise<{ exitCode: number | null; stderr: string; ms: number }>(
      (resolve) =>
        child.once("close", (exitCode) =>
          resolve({ exitCode, stderr, ms: Date.now() - started })
        )
    );
  }

  it("is Node's own, silent, with the command's exit code, when nothing is left open", async () => {
    const ended = await run("clean", "process.exitCode = 1;");
    expect(ended).toMatchObject({ exitCode: 1, stderr: "" });
  });

  it("is explicit, with the command's exit code, when something was left open, and names it", async () => {
    const ended = await run(
      "leaky",
      `net.createServer().listen(0, "127.0.0.1");
setInterval(() => {}, 1000);
process.exitCode = 1;`
    );
    expect(ended.exitCode).toBe(1);
    expect(ended.stderr).toMatch(
      /did not end by itself within 0\.3 s of finishing: something it started was not closed\. Node still holds open: .*\. Exiting with code 1\./
    );
    expect(ended.stderr).toContain("1 TCPServerWrap");
    expect(ended.stderr).toContain("1 Timeout");
    // Its own output streams are not counted as left open.
    expect(ended.stderr).not.toContain("PipeWrap");
    expect(ended.ms).toBeLessThan(10_000);
  });

  it("writes an error main throws and exits with code 2, left open or not", async () => {
    const ended = await run(
      "failing",
      `setInterval(() => {}, 1000);
throw new Error("The lab app is not reachable.");`
    );
    expect(ended.exitCode).toBe(2);
    expect(ended.stderr).toMatch(/^The lab app is not reachable\.\n/);
    expect(ended.stderr).toContain("Exiting with code 2.");
  });
});
