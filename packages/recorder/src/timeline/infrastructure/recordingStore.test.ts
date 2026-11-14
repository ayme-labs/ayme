import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { Timeline } from "../domain/timeline";
import { findTrace, saveRecording } from "./recordingStore";

// The store of Recording Packages, on a real folder: what a save leaves
// there when it cannot be completed, and what is found of a recording's
// trace.

let project: string;
beforeEach(async () => {
  project = await mkdtemp(join(tmpdir(), "ayme-recorder-store-"));
});
afterEach(() => rm(project, { recursive: true }));

const recordings = () => join(project, ".ayme", "recordings");
const createdAt = new Date("2026-11-12T14:50:47.604Z");
const recordingId = "rec_20261112T145047604Z";
const exists = (path: string) =>
  stat(path).then(
    () => true,
    () => false
  );

/** A timeline with one click: a recording there is something to write of. */
async function recorded() {
  const timeline = new Timeline();
  const tree = `- button "Save" [ref=e1]`;
  await timeline.add({
    kind: "visit",
    page: "page_1",
    url: "http://shop.test/",
    cause: "initial",
  });
  for (const id of ["snapshot_1", "snapshot_2"])
    await timeline.add({
      kind: "snapshot",
      snapshot: { id, page: "page_1", url: "http://shop.test/", at: 10, tree },
    });
  await timeline.add({
    kind: "interaction",
    interaction: {
      page: "page_1",
      report: { type: "click", selector: null, target: null, values: {} },
      before: "snapshot_1",
      after: "snapshot_2",
      at: 15,
    },
  });
  return timeline;
}

describe("saving a recording", () => {
  it("removes the trace's own file when there is nothing to write, and minds none that is already gone", async () => {
    const file = join(project, "trace-in-the-making.zip");
    await writeFile(file, "a trace");

    await expect(
      saveRecording(new Timeline(), {
        projectDir: project,
        createdAt,
        trace: { file, positions: {} },
      })
    ).resolves.toBeNull();
    expect(await exists(file)).toBe(false);

    // The browser never wrote this one.
    await expect(
      saveRecording(new Timeline(), {
        projectDir: project,
        createdAt,
        trace: { file, positions: {} },
      })
    ).resolves.toBeNull();
    expect(await exists(join(project, ".ayme"))).toBe(false);
  });

  it("leaves nothing behind when it cannot be completed, and an earlier recording as it was", async () => {
    const folder = await saveRecording(await recorded(), {
      projectDir: project,
      createdAt,
      trace: null,
    });
    expect(folder).toBe(join(recordings(), recordingId));
    const saved = await readFile(join(folder!, "package.yaml"), "utf8");

    // The same moment again, with a trace whose file cannot be copied.
    await expect(
      saveRecording(await recorded(), {
        projectDir: project,
        createdAt,
        trace: { file: join(project, "no-such-trace.zip"), positions: {} },
      })
    ).rejects.toMatchObject({ code: "ENOENT" });

    expect((await readdir(recordings())).sort()).toEqual([
      "latest.yaml",
      recordingId,
    ]);
    expect(await readdir(folder!)).toEqual(["package.yaml"]);
    expect(await readFile(join(folder!, "package.yaml"), "utf8")).toBe(saved);
    expect(await readFile(join(recordings(), "latest.yaml"), "utf8")).toBe(
      saved
    );
  });
});

describe("finding a recording's trace", () => {
  /** A recording as the recorder leaves it, with this text for its package. */
  async function recording(id: string, text: string) {
    await mkdir(join(recordings(), id), { recursive: true });
    await writeFile(join(recordings(), id, "package.yaml"), text);
    await writeFile(join(recordings(), "latest.yaml"), text);
  }
  const packageOf = (...head: string[]) =>
    [...head, `visits: []`, ``].join("\n");
  const tracePath = `.ayme/recordings/rec_1/trace.zip`;

  it("finds the file the package names, for `latest` and for the recording's id", async () => {
    await recording(
      "rec_1",
      packageOf(`recordingId: rec_1`, `tracePath: ${tracePath}`)
    );
    await writeFile(join(project, tracePath), "a trace");
    const found = { kind: "found", file: join(project, tracePath) };

    expect(await findTrace(project, "latest")).toEqual(found);
    expect(await findTrace(project, "rec_1")).toEqual(found);
  });

  it("reads a package whose lines end as Windows ends them", async () => {
    await recording(
      "rec_1",
      packageOf(`recordingId: rec_1`, `tracePath: ${tracePath}`).replaceAll(
        "\n",
        "\r\n"
      )
    );
    await writeFile(join(project, tracePath), "a trace");

    expect(await findTrace(project, "latest")).toEqual({
      kind: "found",
      file: join(project, tracePath),
    });
  });

  it("reads a field's value as YAML does, without the blanks around it", async () => {
    await recording(
      "rec_1",
      packageOf(`recordingId: rec_1  `, `tracePath:  ${tracePath}\t`)
    );
    await writeFile(join(project, tracePath), "a trace");

    expect(await findTrace(project, "latest")).toEqual({
      kind: "found",
      file: join(project, tracePath),
    });
    await rm(join(project, tracePath));
    expect(await findTrace(project, "latest")).toMatchObject({
      reason: `The trace of recording "rec_1" is gone: ${join(project, tracePath)} is not there.`,
    });
  });

  it("says that there is no recording, or which one it could not find", async () => {
    expect(await findTrace(project, "latest")).toEqual({
      kind: "missing",
      reason: "No recording found in .ayme/recordings. Record a flow first.",
    });
    expect(await findTrace(project, "rec_9")).toEqual({
      kind: "missing",
      reason: 'No recording "rec_9" found in .ayme/recordings.',
    });
  });

  it("says that the latest recording has no trace, naming it by the id its package gives", async () => {
    await recording(
      "rec_1",
      packageOf(`recordingId: rec_1`, `tracePath: null`)
    );

    expect(await findTrace(project, "latest")).toEqual({
      kind: "missing",
      reason: 'Recording "rec_1" has no trace.',
    });
  });

  it("takes a package without the line for its trace as one with no trace, and names it as it was asked for when its id is missing too", async () => {
    await recording("rec_1", packageOf(`mode: structural`));

    expect(await findTrace(project, "rec_1")).toEqual({
      kind: "missing",
      reason: 'Recording "rec_1" has no trace.',
    });
  });

  it("says that a trace the package names is gone, with where it should be", async () => {
    await recording(
      "rec_1",
      packageOf(`recordingId: rec_1`, `tracePath: ${tracePath}`)
    );

    expect(await findTrace(project, "latest")).toEqual({
      kind: "missing",
      reason: `The trace of recording "rec_1" is gone: ${join(project, tracePath)} is not there.`,
    });
  });
});
