import { existsSync, fstatSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  passThroughPlaywrightCli,
  passThroughTraceTool,
  positionsOfSnapshots,
  runTraceTool,
  snapshotPositions,
} from "./traceTool";

// What the stock `playwright trace actions` prints, as run on Playwright 1.62
// and 1.64 for a trace of one page with two snapshot markers: the markers
// are groups that hold one call, which is what a snapshot is opened by.
const actions = [
  `     # Time       Action                                                  Duration`,
  `  ──── ─────────  ─────────────────────────────────────────────────────── ────────`,
  `    1. 0:00.001  Create page                                                207ms`,
  `    2. 0:00.211  Set content                                                 31ms`,
  `    3. 0:00.252  snapshot_1                                                   5ms`,
  `    4. 0:00.252    Evaluate                                                   3ms`,
  `    5. 0:00.257  Evaluate                                                     1ms`,
  `    6. 0:00.259  snapshot_2                                                   2ms`,
  `    7. 0:00.259    Evaluate                                                   1ms`,
  `    8. 0:00.261  Evaluate                                                     1ms`,
].join("\n");

const ids = new Set(["snapshot_1", "snapshot_2"]);

describe("the positions of a trace's snapshots", () => {
  it("are the numbers of the calls inside the markers, as the stock trace tool lists them", () => {
    expect(positionsOfSnapshots(actions, ids)).toEqual({
      snapshot_1: "4",
      snapshot_2: "7",
    });
  });

  it("are none in a trace without markers", () => {
    expect(
      positionsOfSnapshots(actions.split("\n").slice(0, 4).join("\n"), ids)
    ).toEqual({});
  });

  it("leave out a marker that has no call inside it", () => {
    expect(
      positionsOfSnapshots(
        [
          `    3. 0:00.252  snapshot_1                                                   5ms`,
          `    4. 0:00.257  Evaluate                                                     1ms`,
        ].join("\n"),
        ids
      )
    ).toEqual({});
  });

  it("look only for the markers of the snapshots it is given", () => {
    expect(
      positionsOfSnapshots(actions, new Set(["snapshot_2", "snapshot_9"]))
    ).toEqual({ snapshot_2: "7" });
  });

  it("are read past the ninth action", () => {
    const long = [
      ...Array.from(
        { length: 10 },
        (_, i) =>
          `   ${String(i + 1).padStart(2)}. 0:00.0${i}0  Evaluate                                                     1ms`
      ),
      `   11. 0:00.300  snapshot_1                                                   2ms`,
      `   12. 0:00.300    Evaluate                                                   1ms`,
    ].join("\n");
    expect(positionsOfSnapshots(long, ids)).toEqual({ snapshot_1: "12" });
  });

  it("are read from the tool's output with Windows line endings", () => {
    expect(positionsOfSnapshots(actions.replaceAll("\n", "\r\n"), ids)).toEqual(
      { snapshot_1: "4", snapshot_2: "7" }
    );
  });

  it("are read from rows with more space after their number than the tool prints today", () => {
    expect(
      positionsOfSnapshots(actions.replaceAll(". 0:", ".  0:"), ids)
    ).toEqual({ snapshot_1: "4", snapshot_2: "7" });
  });

  it("leave out a group whose name only begins with a snapshot's id", () => {
    expect(
      positionsOfSnapshots(
        [
          `    3. 0:00.252  snapshot_1  retried                                          5ms`,
          `    4. 0:00.252    Evaluate                                                   3ms`,
        ].join("\n"),
        ids
      )
    ).toEqual({});
  });

  it("count only the tool's own numbered rows as calls, not a line that merely holds one", () => {
    expect(
      positionsOfSnapshots(
        [
          `    3. 0:00.252  snapshot_1                                                   5ms`,
          `warning:    4. 0:00.252    Evaluate                                           3ms`,
        ].join("\n"),
        ids
      )
    ).toEqual({});
  });
});

// The tool is run through Playwright's own command line: here, a stand-in
// `cli.js` that does what a test gives it and writes down how it was run.
describe("running Playwright's command line", () => {
  let folder: string;
  beforeEach(async () => {
    folder = await mkdtemp(join(tmpdir(), "ayme-recorder-cli-"));
  });
  afterEach(() => rm(folder, { recursive: true }));

  /** A stand-in `cli.js` that writes its arguments, its folder and its
   * standard output's identity to `ran.json`, then runs `then`. */
  async function cliThat(then: string) {
    const cli = join(folder, "cli.js");
    await writeFile(
      cli,
      `const fs = require("node:fs");
const out = fs.fstatSync(1);
fs.writeFileSync(${JSON.stringify(join(folder, "ran.json"))}, JSON.stringify({
  args: process.argv.slice(2),
  cwd: process.cwd(),
  stdout: [out.dev, out.ino],
}));
${then}\n`
    );
    return cli;
  }
  const ran = async () =>
    JSON.parse(await readFile(join(folder, "ran.json"), "utf8")) as {
      args: string[];
      cwd: string;
      stdout: number[];
    };

  it("gives a trace tool's run its exit code and what it printed", async () => {
    const cli = await cliThat(
      `process.stdout.write("listed"); process.stderr.write("warned"); process.exit(3);`
    );

    expect(await runTraceTool(cli, ["actions"], folder)).toEqual({
      code: 3,
      stdout: "listed",
      stderr: "warned",
    });
    expect((await ran()).args).toEqual(["trace", "actions"]);
  });

  it("gives a trace tool's run that ends well the code 0 and what it printed, run in the folder it is given", async () => {
    const cli = await cliThat(`process.stdout.write("listed");`);

    expect(await runTraceTool(cli, ["actions"], folder)).toEqual({
      code: 0,
      stdout: "listed",
      stderr: "",
    });
    // The folder as the stand-in sees it, which may be a symlinked one.
    expect((await ran()).cwd).toContain(folder.split("/").pop()!);
  });

  it("gives a trace tool's run that a signal ended the exit code 1", async () => {
    const cli = await cliThat(`process.kill(process.pid, "SIGTERM");`);

    expect((await runTraceTool(cli, ["actions"], folder)).code).toBe(1);
  });

  it("passes `trace` and the arguments through, in the folder it is given, with the terminal as the tool's own", async () => {
    const cli = await cliThat(`process.exit(4);`);

    expect(await passThroughTraceTool(cli, ["open", "t.zip"], folder)).toBe(4);
    const { args, cwd, stdout } = await ran();
    expect(args).toEqual(["trace", "open", "t.zip"]);
    // The folder as the stand-in sees it, which may be a symlinked one.
    expect(cwd).toContain(folder.split("/").pop()!);
    // Its standard output is this process's own, not a pipe.
    const own = fstatSync(1);
    expect(stdout).toEqual([own.dev, own.ino]);
  });

  it("answers 1 when the command line cannot even start", async () => {
    const cli = await cliThat(`process.exit(0);`);

    expect(await passThroughPlaywrightCli(cli, [], join(folder, "gone"))).toBe(
      1
    );
  });
});

// The positions as the engine asks for them: the tool opens the trace, lists
// its actions and closes it, as a stand-in `cli.js` plays it here, writing
// down each run.
describe("the positions of a trace's snapshots, from the trace tool", () => {
  let folder: string;
  beforeEach(async () => {
    folder = await mkdtemp(join(tmpdir(), "ayme-recorder-tool-"));
  });
  afterEach(() => rm(folder, { recursive: true }));

  /** A stand-in trace tool that lists `actions` when asked to, and fails at
   * the commands in `failing`, after what it printed. */
  async function tool(failing: readonly string[] = []) {
    const cli = join(folder, "cli.js");
    await writeFile(
      cli,
      `const fs = require("node:fs");
const [, command] = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(join(folder, "runs.jsonl"))}, JSON.stringify({ args: process.argv.slice(2), cwd: process.cwd() }) + "\\n");
if (command === "actions") process.stdout.write(${JSON.stringify(actions)});
if (${JSON.stringify(failing)}.includes(command)) process.exit(1);
`
    );
    return cli;
  }
  const runs = async () =>
    (await readFile(join(folder, "runs.jsonl"), "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { args: string[]; cwd: string });

  it("opens the trace, lists its actions and closes it, in one folder of its own that is gone after", async () => {
    const cli = await tool();

    expect(await snapshotPositions(cli, "/traces/trace.zip", ids)).toEqual({
      snapshot_1: "4",
      snapshot_2: "7",
    });
    const all = await runs();
    expect(all.map(({ args }) => args)).toEqual([
      ["trace", "open", "/traces/trace.zip"],
      ["trace", "actions"],
      ["trace", "close"],
    ]);
    // The tool keeps what it opened per folder: one for these three runs.
    expect(new Set(all.map(({ cwd }) => cwd)).size).toBe(1);
    expect(all[0]!.cwd).not.toContain(folder.split("/").pop()!);
    expect(existsSync(all[0]!.cwd)).toBe(false);
  });

  it("gives none, and still closes the tool's folder, when the tool cannot open the trace", async () => {
    const cli = await tool(["open"]);

    expect(await snapshotPositions(cli, "/traces/trace.zip", ids)).toEqual({});
    const all = await runs();
    expect(all.map(({ args }) => args[1])).toEqual(["open", "close"]);
    expect(existsSync(all[0]!.cwd)).toBe(false);
  });

  it("gives none, and still closes the tool's folder, when the tool fails to list the actions, whatever it printed", async () => {
    const cli = await tool(["actions"]);

    expect(await snapshotPositions(cli, "/traces/trace.zip", ids)).toEqual({});
    expect((await runs()).map(({ args }) => args[1])).toEqual([
      "open",
      "actions",
      "close",
    ]);
  });
});
