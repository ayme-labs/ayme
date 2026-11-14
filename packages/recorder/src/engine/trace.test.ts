import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { runTrace, traceInvocation } from "./trace";

// `trace` goes to the project's own `playwright trace`. What the engine
// decides is which trace file the arguments name: the recording that is the
// latest, a recording by its id, or a file.

let project: string;
beforeEach(async () => {
  project = await mkdtemp(join(tmpdir(), "ayme-recorder-trace-command-"));
});
afterEach(() => rm(project, { recursive: true }));

const recordings = () => join(project, ".ayme", "recordings");

/** A recording as the recorder leaves it. */
async function recording(id: string, tracePath: string | null) {
  const folder = join(recordings(), id);
  await mkdir(folder, { recursive: true });
  const text = [
    `recordingId: ${id}`,
    `mode: structural`,
    `tracePath: ${tracePath ?? "null"}`,
    `visits: []`,
    ``,
  ].join("\n");
  await writeFile(join(folder, "package.yaml"), text);
  await writeFile(join(recordings(), "latest.yaml"), text);
  if (tracePath) await writeFile(join(project, tracePath), "a trace");
  return join(project, tracePath ?? "");
}
const traceOf = (id: string) => `.ayme/recordings/${id}/trace.zip`;

describe("the trace command", () => {
  it("opens the trace of the latest recording for `latest`", async () => {
    const file = await recording("rec_1", traceOf("rec_1"));

    expect(await traceInvocation(project, ["latest"])).toEqual({
      kind: "run",
      args: ["open", file],
    });
  });

  it("opens the trace of a recording by its id", async () => {
    await recording("rec_1", traceOf("rec_1"));
    const second = await recording("rec_2", traceOf("rec_2"));
    // Recording 1 is no longer the latest, and is found all the same.
    expect(await traceInvocation(project, ["rec_2"])).toEqual({
      kind: "run",
      args: ["open", second],
    });
    expect(await traceInvocation(project, ["rec_1"])).toEqual({
      kind: "run",
      args: ["open", join(project, traceOf("rec_1"))],
    });
  });

  it("opens a trace file for its path", async () => {
    const file = join(project, "elsewhere.zip");
    await writeFile(file, "a trace");

    expect(await traceInvocation(project, [file])).toEqual({
      kind: "run",
      args: ["open", file],
    });
    expect(await traceInvocation(project, ["elsewhere.zip"])).toEqual({
      kind: "run",
      args: ["open", file],
    });
  });

  it("takes a name that only starts or ends like a recording's id for what it is", async () => {
    await recording("rec_1", traceOf("rec_1"));
    const file = join(project, "rec_1.zip");
    await writeFile(file, "a trace");

    // A file whose name begins with an id is a file, and a name that ends
    // with one is the stock tool's own word.
    expect(await traceInvocation(project, ["rec_1.zip"])).toEqual({
      kind: "run",
      args: ["open", file],
    });
    expect(await traceInvocation(project, ["old_rec_1"])).toEqual({
      kind: "run",
      args: ["old_rec_1"],
    });
  });

  it("takes the stock tool's `open` with `latest` or an id in place of the file, and no target for the latest", async () => {
    const file = await recording("rec_1", traceOf("rec_1"));

    for (const args of [["open", "latest"], ["open", "rec_1"], ["open"]])
      expect(await traceInvocation(project, args)).toEqual({
        kind: "run",
        args: ["open", file],
      });
  });

  it("leaves the rest of the arguments to the stock tool", async () => {
    const file = await recording("rec_1", traceOf("rec_1"));

    expect(await traceInvocation(project, ["latest", "--extra"])).toEqual({
      kind: "run",
      args: ["open", file, "--extra"],
    });
  });

  it.each([
    { name: "no arguments", args: [] },
    { name: "a command of the stock tool", args: ["actions", "--grep", "x"] },
    { name: "a snapshot", args: ["snapshot", "4", "--phase", "after"] },
    { name: "help", args: ["open", "--help"] },
    { name: "an open of a path", args: ["open", "some/trace.zip"] },
  ])("passes $name on as it is", async ({ args }) => {
    await recording("rec_1", traceOf("rec_1"));

    expect(await traceInvocation(project, args)).toEqual({
      kind: "run",
      args,
    });
  });

  it("leaves an argument that looks like a flag to the stock tool, though a file has that name", async () => {
    await writeFile(join(project, "--trace.zip"), "a trace");

    expect(await traceInvocation(project, ["--trace.zip"])).toEqual({
      kind: "run",
      args: ["--trace.zip"],
    });
  });

  it("says that there is no recording to open when there is none", async () => {
    expect(await traceInvocation(project, ["latest"])).toEqual({
      kind: "error",
      message: expect.stringContaining(".ayme/recordings"),
    });
  });

  it("says which recording it could not find", async () => {
    await recording("rec_1", traceOf("rec_1"));

    expect(await traceInvocation(project, ["rec_other"])).toEqual({
      kind: "error",
      message: expect.stringContaining('"rec_other"'),
    });
  });

  it("says that a recording has no trace when it has none", async () => {
    await recording("rec_1", null);

    expect(await traceInvocation(project, ["rec_1"])).toEqual({
      kind: "error",
      message: expect.stringContaining('"rec_1" has no trace'),
    });
  });

  it("says that a trace the package names is gone when its file is missing", async () => {
    await recording("rec_1", traceOf("rec_1"));
    await rm(join(project, traceOf("rec_1")));

    expect(await traceInvocation(project, ["latest"])).toEqual({
      kind: "error",
      message: expect.stringContaining("trace.zip"),
    });
  });
});

// `trace` runs the project's own Playwright. The tests give it a stand-in
// `cli.js` that writes down how it was run and exits with the code in
// `exit-code`.
describe("running the trace command", () => {
  afterEach(() => vi.restoreAllMocks());

  async function installPlaywright(exitCode = 0) {
    const folder = join(project, "node_modules", "playwright");
    await mkdir(folder, { recursive: true });
    await writeFile(
      join(folder, "package.json"),
      JSON.stringify({ name: "playwright", version: "1.64.0" })
    );
    await writeFile(
      join(folder, "cli.js"),
      `require("node:fs").writeFileSync(
  ${JSON.stringify(join(project, "ran.json"))},
  JSON.stringify({ args: process.argv.slice(2) })
);
process.exit(${exitCode});\n`
    );
  }
  const ran = async () =>
    (
      JSON.parse(await readFile(join(project, "ran.json"), "utf8")) as {
        args: string[];
      }
    ).args;
  /** What the command wrote to stderr while `run` ran. */
  async function stderrOf(run: () => Promise<unknown>) {
    const written: string[] = [];
    vi.spyOn(process.stderr, "write").mockImplementation((text) => {
      written.push(String(text));
      return true;
    });
    await run();
    return written.join("");
  }

  it("gives the project's Playwright `trace` and the trace file the arguments name, and its exit code", async () => {
    await installPlaywright(3);
    const file = await recording("rec_1", traceOf("rec_1"));

    const code = await runTrace({ projectDir: project, args: ["latest"] });

    expect(code).toBe(3);
    expect(await ran()).toEqual(["trace", "open", file]);
  });

  it("gives it the arguments of one of its own commands as they are", async () => {
    await installPlaywright();

    expect(
      await runTrace({ projectDir: project, args: ["actions", "--grep", "x"] })
    ).toBe(0);
    expect(await ran()).toEqual(["trace", "actions", "--grep", "x"]);
  });

  it("says what could not be found, without running Playwright, and exits with 1", async () => {
    await installPlaywright();
    let code: number | undefined;

    const told = await stderrOf(async () => {
      code = await runTrace({ projectDir: project, args: ["rec_other"] });
    });

    expect(code).toBe(1);
    expect(told).toBe('No recording "rec_other" found in .ayme/recordings.\n');
    await expect(readFile(join(project, "ran.json"), "utf8")).rejects.toThrow(
      /ENOENT/
    );
  });

  it("says that the project has no Playwright, with no stack trace, and exits with 1", async () => {
    let code: number | undefined;

    const told = await stderrOf(async () => {
      code = await runTrace({ projectDir: project, args: ["latest"] });
    });

    expect(code).toBe(1);
    expect(told).toBe(
      `No Playwright is installed in ${project}. The trace tool is the project's own: install Playwright there, for example with "npm install -D @playwright/test".\n`
    );
  });
});
