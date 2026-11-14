import { fstatSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  passThroughPlaywrightCli,
  passThroughTraceTool,
  positionsOfSnapshots,
  runTraceTool,
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
