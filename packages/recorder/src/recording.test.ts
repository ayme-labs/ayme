import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { RecorderUpdate } from "./index";
import { startScriptedRecorder } from "./testing";

// A recording on the scripted browser, with a test clock: what the handle
// answers and shows, what it asks of the browser, and the package on disk.

let projectDir: string;
beforeEach(async () => {
  projectDir = await mkdtemp(join(tmpdir(), "ayme-recorder-recording-"));
});
afterEach(() => rm(projectDir, { recursive: true }));

const start = () =>
  startScriptedRecorder({ projectDir, url: "http://shop.test/" });

const idle = [`- generic [ref=e1]:`, `  - button "Save" [ref=e2]`].join("\n");
const saved = [
  `- generic [ref=e1]:`,
  `  - button "Save" [ref=e2]`,
  `  - status [ref=e3]: Saved`,
].join("\n");
const waitForSettled = {
  kind: "waitForSettled",
  page: "page_1",
  input: "input_1",
} as const;
const click = {
  type: "click",
  selector: 'internal:role=button[name="Save"i]',
  target: { ref: "e2", tree: idle },
  values: { button: "left", modifiers: 0, clickCount: 1 },
};
// The scripted recorder's clock stands at zero.
const recordingId = "rec_19700101T000000000Z";
const savedClick = [
  `    timelineEntries:`,
  `      - kind: interaction`,
  `        timestamp: 2`,
  `        interaction:`,
  `          id: interaction_1`,
  `          type: click`,
  `          targetRef: e2`,
  `          targetSelector: internal:role=button[name="Save"i]`,
  `          button: left`,
  `          modifiers: 0`,
  `          clickCount: 1`,
  `        changeTree:`,
  `          - [ref=e1]:`,
  `            - <added> [ref=e3] status: Saved`,
  `traceActionPoints: []`,
  ``,
].join("\n");

describe("a recording", () => {
  it("starts on Record: Playwright reports Interactions and the pages hold inputs back", async () => {
    const { recorder, browser } = await start();
    const updates: RecorderUpdate[] = [];
    recorder.subscribe((update) => updates.push(update));

    await expect(recorder.send({ type: "record" })).resolves.toBe("applied");

    expect(updates.at(-1)).toEqual({
      revision: 1,
      state: { phase: "recording" },
    });
    expect(browser.asked).toEqual([
      { kind: "reportInteractions" },
      { kind: "holdInputs", on: true },
    ]);
  });

  it("takes a held click's 'before', passes it on, and takes its 'after' once the page is settled", async () => {
    const { recorder, browser } = await start();
    await recorder.send({ type: "record" });

    browser.holdClick();
    await browser.asks(waitForSettled);
    expect(browser.asked.slice(2)).toEqual([
      { kind: "takeSnapshot", snapshot: "snapshot_1", page: "page_1" },
      { kind: "passOn", input: "input_1" },
      { kind: "waitForSettled", page: "page_1", input: "input_1" },
    ]);

    browser.settle();
    await browser.asks({
      kind: "takeSnapshot",
      snapshot: "snapshot_2",
      page: "page_1",
    });
  });

  it("saves a click on Finish as a Recording Package in the released location", async () => {
    const { recorder, browser } = await start();
    browser.showPage(idle);
    await recorder.send({ type: "record" });
    browser.holdClick();
    await browser.asks(waitForSettled);
    browser.showPage(saved);
    browser.settle();
    browser.report(click);

    await expect(recorder.send({ type: "finish" })).resolves.toBe("applied");

    const folder = join(projectDir, ".ayme", "recordings", recordingId);
    await expect(recorder.done).resolves.toEqual({ kind: "saved", folder });
    const text = await readFile(join(folder, "package.yaml"), "utf8");
    expect(text).toContain(
      [
        `recordingId: ${recordingId}`,
        `mode: structural`,
        `createdAt: 1970-01-01T00:00:00.000Z`,
        `url: http://shop.test/`,
        `tracePath: null`,
        `visits:`,
        `  - visitId: visit_1`,
        `    url: http://shop.test/`,
        `    cause: initial`,
        `    baselineTree:`,
        `      - [ref=e1]:`,
        `        - [ref=e2] button "Save"`,
        ``,
      ].join("\n")
    );
    expect(text).toContain(savedClick);
    // The latest recording is also filed as "latest".
    await expect(
      readFile(join(projectDir, ".ayme", "recordings", "latest.yaml"), "utf8")
    ).resolves.toBe(text);
    expect(await readdir(folder)).toEqual(["package.yaml"]);
  });

  it("replaces an earlier 'latest', and the semantic one of the released recorder", async () => {
    const recordings = join(projectDir, ".ayme", "recordings");
    const first = await start();
    await first.recorder.send({ type: "record" });
    await first.recorder.send({ type: "finish" });
    await first.recorder.done;
    await writeFile(join(recordings, "latest.json"), "{}");
    await writeFile(join(recordings, "latest.yaml"), "older");

    const second = await start();
    await second.recorder.send({ type: "record" });
    await second.recorder.send({ type: "finish" });
    const outcome = await second.recorder.done;

    expect((await readdir(recordings)).sort()).toEqual([
      "latest.yaml",
      recordingId,
    ]);
    expect(await readFile(join(recordings, "latest.yaml"), "utf8")).toBe(
      await readFile(
        join((outcome as { folder: string }).folder, "package.yaml"),
        "utf8"
      )
    );
  });

  it("passes on a click that is held when Finish is pressed, and saves it", async () => {
    const { recorder, browser } = await start();
    browser.showPage(idle);
    await recorder.send({ type: "record" });
    // The page is slow to be read: the click is still held at Finish.
    browser.holdSnapshots();
    browser.holdClick();
    await browser.asks({
      kind: "takeSnapshot",
      snapshot: "snapshot_1",
      page: "page_1",
    });

    await expect(recorder.send({ type: "finish" })).resolves.toBe("applied");
    expect(browser.asked).not.toContainEqual({
      kind: "passOn",
      input: "input_1",
    });
    browser.releaseSnapshots();
    await browser.asks(waitForSettled);
    browser.showPage(saved);
    browser.settle();
    browser.report(click);

    const outcome = await recorder.done;
    expect(browser.asked).toContainEqual({ kind: "passOn", input: "input_1" });
    expect(
      await readFile(
        join((outcome as { folder: string }).folder, "package.yaml"),
        "utf8"
      )
    ).toContain(savedClick);
  });

  it("shows the wrap-up and the save, and lets the browser go only after the package is written", async () => {
    const { recorder, browser } = await start();
    const phases: string[] = [];
    recorder.subscribe((update) => phases.push(update.state.phase));
    await recorder.send({ type: "record" });

    await recorder.send({ type: "finish" });
    await recorder.done;

    expect(phases).toEqual([
      "notRecording",
      "recording",
      "wrappingUp",
      "saving",
      "ended",
    ]);
    expect(browser.asked).toContainEqual({ kind: "holdInputs", on: false });
    expect(browser.released).toBe(true);
  });

  it("saves once when Finish is pressed twice", async () => {
    const { recorder } = await start();
    await recorder.send({ type: "record" });

    const answers = await Promise.all([
      recorder.send({ type: "finish" }),
      recorder.send({ type: "finish" }),
    ]);
    await recorder.done;

    expect(answers).toEqual(["applied", "ignored"]);
    await expect(recorder.send({ type: "finish" })).resolves.toBe("ignored");
    expect(await readdir(join(projectDir, ".ayme", "recordings"))).toEqual([
      "latest.yaml",
      recordingId,
    ]);
  });

  it("waits for a report during the wrap-up, and saves without it once the time limit has passed", async () => {
    const { recorder, browser } = await start();
    browser.showPage(idle);
    await recorder.send({ type: "record" });
    browser.holdClick();
    await browser.asks(waitForSettled);
    browser.settle();
    // Playwright never reports this click.
    const phases: string[] = [];
    recorder.subscribe((update) => phases.push(update.state.phase));

    await recorder.send({ type: "finish" });
    // Everything else is done: the last snapshot is in.
    await browser.asks({
      kind: "takeSnapshot",
      snapshot: "snapshot_3",
      page: "page_1",
    });
    await browser.advanceTime(4_999);
    expect(phases).toEqual(["recording", "wrappingUp"]);

    await browser.advanceTime(1);
    const outcome = await recorder.done;

    expect(outcome.kind).toBe("saved");
    expect(
      await readFile(
        join((outcome as { folder: string }).folder, "package.yaml"),
        "utf8"
      )
    ).toContain(`    timelineEntries: []\ntraceActionPoints: []\n`);
  });

  it("saves a recording that is ended from outside, as Finish does", async () => {
    const { recorder } = await start();
    await recorder.send({ type: "record" });

    recorder.end();
    recorder.end();

    await expect(recorder.done).resolves.toEqual({
      kind: "saved",
      folder: join(projectDir, ".ayme", "recordings", recordingId),
    });
  });

  it("fails its end when the package cannot be written, and still lets the browser go", async () => {
    // The project's `.ayme` is a file: no folder can be made in it.
    await writeFile(join(projectDir, ".ayme"), "");
    const { recorder, browser } = await start();
    await recorder.send({ type: "record" });

    await recorder.send({ type: "finish" });

    await expect(recorder.done).rejects.toThrow(/ENOTDIR|EEXIST/);
    expect(browser.released).toBe(true);
  });
});
