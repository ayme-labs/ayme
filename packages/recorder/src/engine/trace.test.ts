import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { traceInvocation } from "./trace";

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
