import {
  appendFile,
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Timeline } from "../domain/timeline";
import { saveRecording } from "./recordingStore";
import { pageId, snapshotId } from "../../../testing/ids";

// The store of Recording Packages, on a real folder: what a save leaves
// there when it cannot be completed, and what is found of a recording's
// trace.

// The real file system, but for one moment no test can otherwise reach:
// between the creation of a file and the first write to it, where another
// tool may write to the same file.
const betweenCreationAndFirstWrite = vi.hoisted(() => ({
  of: undefined as { file: string; run: () => Promise<void> } | undefined,
}));
vi.mock("node:fs/promises", async (importOriginal) => {
  const real = await importOriginal<typeof import("node:fs/promises")>();
  const writeFile: typeof real.writeFile = async (file, data, options) => {
    const { of } = betweenCreationAndFirstWrite;
    const flag = typeof options === "object" ? options?.flag : undefined;
    if (of === undefined || flag === undefined || file !== of.file)
      return real.writeFile(file, data, options);
    betweenCreationAndFirstWrite.of = undefined;
    const handle = await real.open(of.file, flag);
    try {
      await of.run();
      await handle.writeFile(data);
    } finally {
      await handle.close();
    }
  };
  return { ...real, writeFile };
});

let project: string;
beforeEach(async () => {
  project = await mkdtemp(join(tmpdir(), "ayme-recorder-store-"));
});
afterEach(() => rm(project, { recursive: true }));

const recordings = () => join(project, "ayme", "recordings");
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
    page: pageId("page_1"),
    url: "http://shop.test/",
    cause: "initial",
  });
  for (const id of [snapshotId("snapshot_1"), snapshotId("snapshot_2")])
    await timeline.add({
      kind: "snapshot",
      snapshot: {
        id,
        page: pageId("page_1"),
        url: "http://shop.test/",
        at: 10,
        tree,
      },
    });
  await timeline.add({
    kind: "interaction",
    interaction: {
      page: pageId("page_1"),
      report: { type: "click", selector: null, target: null, values: {} },
      before: snapshotId("snapshot_1"),
      after: snapshotId("snapshot_2"),
      at: 15,
    },
  });
  return timeline;
}

describe("the .gitignore of ayme/", () => {
  it("keeps the line `ayme mcp` adds between the file's creation and its first write", async () => {
    const file = join(project, "ayme", ".gitignore");
    betweenCreationAndFirstWrite.of = {
      file,
      run: () => appendFile(file, "init-script.js\n"),
    };

    await saveRecording(await recorded(), {
      projectDir: project,
      createdAt,
      trace: null,
    });

    // The other tool's line first, then the whole of this one's file.
    expect(await readFile(file, "utf8")).toBe(
      "init-script.js\nrecordings/\n.gitignore\n"
    );
  });
});

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
    expect(await exists(join(project, "ayme"))).toBe(false);
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
