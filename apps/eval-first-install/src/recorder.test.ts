import { execFile } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, expect, it } from "vitest";

import { recorder } from "./paths.ts";

let project: string;
let record: string;
beforeEach(() => {
  project = realpathSync(
    mkdtempSync(join(tmpdir(), "eval-first-install-recorder-"))
  );
  record = join(project, "record.jsonl");
});
afterEach(() => rmSync(project, { recursive: true, force: true }));

/** Installs a stand-in for `@ayme-dev/cli` in the project, whose command
 * runs `body`, and links it from node_modules/.bin as npm does. */
function installCommand(body: string): string {
  const dist = join(project, "node_modules", "@ayme-dev", "cli", "dist");
  mkdirSync(dist, { recursive: true });
  writeFileSync(join(dist, "cli.mjs"), body);
  mkdirSync(join(project, "node_modules", ".bin"));
  const bin = join(project, "node_modules", ".bin", "ayme");
  symlinkSync("../@ayme-dev/cli/dist/cli.mjs", bin);
  return bin;
}

/** Runs `script` with the recorder loaded, as the worker's shell runs a
 * command, in the `phase` the harness names. */
function run(script: string, args: string[], phase = "task") {
  return new Promise<void>((resolve) =>
    execFile(
      process.execPath,
      [`--import=${recorder}`, script, ...args],
      {
        cwd: project,
        env: {
          ...process.env,
          EVAL_FIRST_INSTALL_RECORD: record,
          EVAL_FIRST_INSTALL_PHASE: phase,
        },
      },
      () => resolve()
    )
  );
}

const recorded = () =>
  existsSync(record)
    ? readFileSync(record, "utf8")
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line) as Record<string, unknown>)
    : [];

it("records an ayme command run through its bin link: its arguments, folder and phase, then its exit code and all it printed", async () => {
  const bin = installCommand(
    'process.stdout.write("Tab: List\\n");\nprocess.stdout.write("ListPage\\n");\nprocess.stderr.write("a warning\\n");\nprocess.exitCode = 0;\n'
  );

  await run(bin, ["page-objects", "--tab=http://x/"], "setup");

  const [start, end] = recorded();
  expect(recorded()).toHaveLength(2);
  expect(start).toEqual({
    t: expect.any(String),
    pid: expect.any(Number),
    event: "start",
    phase: "setup",
    args: ["page-objects", "--tab=http://x/"],
    cwd: project,
  });
  expect(end).toEqual({
    t: expect.any(String),
    pid: start!.pid,
    event: "end",
    code: 0,
    stdout: "Tab: List\nListPage\n",
    stderr: "a warning\n",
  });
});

it("records the answer of a command that exits at once with an error", async () => {
  const bin = installCommand(
    'process.stderr.write("No Session is open.\\n");\nprocess.exit(1);\n'
  );

  await run(bin, ["call", "ListPage.addItem"]);

  expect(recorded()[1]).toMatchObject({
    event: "end",
    code: 1,
    stdout: "",
    stderr: "No Session is open.\n",
  });
});

it("records neither the Session's background process nor another Node script", async () => {
  const bin = installCommand('process.stdout.write("started\\n");\n');
  const other = join(project, "other.mjs");
  writeFileSync(other, 'process.stdout.write("other\\n");\n');

  await run(bin, ["__session", "{}"]);
  await run(other, ["call", "ListPage.addItem"]);

  expect(recorded()).toEqual([]);
});
