import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { RecorderUpdate } from "./index";
import { startScriptedRecorder, type ScriptedBrowser } from "./testing";

// Stop, Continue, Clear and the ways a recorder ends, on the scripted
// browser with a test clock: what the handle answers and shows, what it asks
// of the browser, and what is on disk afterwards.

let projectDir: string;
beforeEach(async () => {
  projectDir = await mkdtemp(join(tmpdir(), "ayme-recorder-controls-"));
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
const click = {
  type: "click",
  selector: 'internal:role=button[name="Save"i]',
  target: { ref: "e2", tree: idle },
  values: { button: "left" },
};
const recordings = () => join(projectDir, ".ayme", "recordings");

/** One click from held to written down: the page shows `after` once it has
 * the click. */
async function clickOnce(
  browser: ScriptedBrowser,
  input: string,
  after = idle
) {
  browser.holdClick();
  await browser.asks({ kind: "waitForSettled", page: "page_1", input });
  browser.showPage(after);
  browser.settle();
  browser.report(click);
}

/** The phases a subscriber is shown, each once. */
function phasesOf(recorder: {
  subscribe(listener: (update: RecorderUpdate) => void): unknown;
}) {
  const phases: string[] = [];
  recorder.subscribe(({ state }) => {
    if (phases.at(-1) !== state.phase) phases.push(state.phase);
  });
  return phases;
}
const entriesOf = (update: RecorderUpdate) =>
  update.state.visits.flatMap((visit) => visit.entries);
const idsOf = (update: RecorderUpdate) =>
  entriesOf(update).flatMap((entry) =>
    entry.kind === "interaction" ? [entry.interaction.id] : []
  );

describe("Stop", () => {
  it("wraps up, switches Playwright's recorder off and pauses", async () => {
    const { recorder, browser } = await start();
    const phases = phasesOf(recorder);
    await recorder.send({ type: "record" });

    await expect(recorder.send({ type: "stop" })).resolves.toBe("applied");
    await expect.poll(() => phases.at(-1)).toBe("paused");

    expect(phases).toEqual([
      "notRecording",
      "recording",
      "wrappingUp",
      "paused",
    ]);
    // The pages stop holding inputs back first; Playwright's recorder is
    // switched off last, when its reports are in.
    expect(
      browser.asked
        .filter((request) => request.kind !== "takeSnapshot")
        .slice(2)
    ).toEqual([
      { kind: "holdInputs", on: false },
      { kind: "reportInteractions", on: false },
    ]);
    recorder.end();
    await recorder.done;
  });

  it("answers every command 'ignored' while it wraps up", async () => {
    const { recorder, browser } = await start();
    const phases = phasesOf(recorder);
    await recorder.send({ type: "record" });
    // The page is slow to be read: the wrap-up waits for its last snapshot.
    browser.holdSnapshots();

    await expect(recorder.send({ type: "stop" })).resolves.toBe("applied");
    for (const type of [
      "stop",
      "continue",
      "clear",
      "record",
      "finish",
    ] as const)
      await expect(recorder.send({ type })).resolves.toBe("ignored");
    expect(phases.at(-1)).toBe("wrappingUp");

    // None of them was kept for later: the recorder pauses, and stays so.
    browser.releaseSnapshots();
    await expect.poll(() => phases.at(-1)).toBe("paused");
    await expect(recorder.send({ type: "stop" })).resolves.toBe("ignored");
    expect(phases.at(-1)).toBe("paused");
    recorder.end();
    await recorder.done;
  });

  it("still records a click a page held back after Stop was pressed: 'Paused' is the moment recording ends", async () => {
    const { recorder, browser } = await start();
    browser.showPage(idle);
    const updates: RecorderUpdate[] = [];
    recorder.subscribe((update) => updates.push(update));
    await recorder.send({ type: "record" });
    // The pages have not confirmed yet when the person clicks.
    browser.holdConfirmations();

    await recorder.send({ type: "stop" });
    await clickOnce(browser, "input_1", saved);
    browser.releaseConfirmations();

    await expect.poll(() => updates.at(-1)!.state.phase).toBe("paused");
    expect(idsOf(updates.at(-1)!)).toEqual(["interaction_1"]);
    // It was written down before the recorder showed "paused".
    const firstPaused = updates.find(({ state }) => state.phase === "paused")!;
    expect(idsOf(firstPaused)).toEqual(["interaction_1"]);
    recorder.end();
    await recorder.done;
  });

  it("pauses when the time limit has passed, and passes on a click that is still held", async () => {
    const { recorder, browser } = await start();
    const phases = phasesOf(recorder);
    await recorder.send({ type: "record" });
    // The page cannot be read: the click's "before" never comes.
    browser.holdSnapshots();
    browser.holdClick();
    await browser.asks({
      kind: "takeSnapshot",
      snapshot: "snapshot_1",
      page: "page_1",
    });

    await recorder.send({ type: "stop" });
    await browser.advanceTime(4_999);
    expect(phases.at(-1)).toBe("wrappingUp");
    await browser.advanceTime(1);

    await expect.poll(() => phases.at(-1)).toBe("paused");
    expect(browser.asked).toContainEqual({ kind: "passOn", input: "input_1" });
    recorder.end();
    await expect(recorder.done).resolves.toEqual({ kind: "empty" });
  });
});

describe("a paused recorder", () => {
  it("adds nothing to the timeline: a report is ignored, and a click a page still held back is passed on unrecorded", async () => {
    const { recorder, browser } = await start();
    browser.showPage(idle);
    await recorder.send({ type: "record" });
    await clickOnce(browser, "input_1");
    await recorder.send({ type: "stop" });
    const updates: RecorderUpdate[] = [];
    recorder.subscribe((update) => updates.push(update));
    await expect.poll(() => updates.at(-1)!.state.phase).toBe("paused");
    const paused = updates.at(-1)!;

    browser.report(click);
    browser.holdClick();
    await browser.asks({ kind: "passOn", input: "input_2" });
    browser.report(click);
    // A command is answered after everything that happened before it.
    await expect(recorder.send({ type: "record" })).resolves.toBe("ignored");

    expect(updates.at(-1)).toBe(paused);
    expect(idsOf(paused)).toEqual(["interaction_1"]);
    // The click got no snapshot and no wait: it went straight to its page.
    expect(browser.asked.at(-1)).toEqual({ kind: "passOn", input: "input_2" });
    recorder.end();
    await recorder.done;
  });

  it("saves what was recorded when it is finished, with nothing of the pause in it", async () => {
    const { recorder, browser } = await start();
    browser.showPage(idle);
    await recorder.send({ type: "record" });
    await clickOnce(browser, "input_1");
    await recorder.send({ type: "stop" });
    const phases = phasesOf(recorder);
    await expect.poll(() => phases.at(-1)).toBe("paused");
    const askedWhenPaused = browser.asked.length;
    // What the page does while paused is not the recording's.
    browser.showPage(saved);

    await expect(recorder.send({ type: "finish" })).resolves.toBe("applied");
    const outcome = await recorder.done;

    expect(phases.slice(-3)).toEqual(["paused", "saving", "ended"]);
    // Nothing more was asked of the browser: the page was not read again.
    expect(browser.asked).toHaveLength(askedWhenPaused);
    const text = await readFile(
      join((outcome as { folder: string }).folder, "package.yaml"),
      "utf8"
    );
    expect(text).toContain("id: interaction_1");
    expect(text).not.toContain("status");
  });

  it("saves what was recorded when it is ended from outside, once, however often", async () => {
    const { recorder, browser } = await start();
    browser.showPage(idle);
    await recorder.send({ type: "record" });
    await clickOnce(browser, "input_1");
    await recorder.send({ type: "stop" });
    const phases = phasesOf(recorder);
    await expect.poll(() => phases.at(-1)).toBe("paused");

    recorder.end();
    recorder.end();
    const outcome = await recorder.done;
    recorder.end();

    expect(outcome.kind).toBe("saved");
    expect(phases.slice(-3)).toEqual(["paused", "saving", "ended"]);
    expect(await readdir(recordings())).toHaveLength(2);
    expect(
      await readFile(
        join((outcome as { folder: string }).folder, "package.yaml"),
        "utf8"
      )
    ).toContain("id: interaction_1");
  });
});

describe("Continue", () => {
  it("resumes into the same timeline: Playwright's recorder is switched on again, and the pages hold inputs back", async () => {
    const { recorder, browser } = await start();
    browser.showPage(idle);
    const updates: RecorderUpdate[] = [];
    recorder.subscribe((update) => updates.push(update));
    await recorder.send({ type: "record" });
    await clickOnce(browser, "input_1");
    await recorder.send({ type: "stop" });
    await expect.poll(() => updates.at(-1)!.state.phase).toBe("paused");
    const askedWhenPaused = browser.asked.length;

    await expect(recorder.send({ type: "continue" })).resolves.toBe("applied");

    expect(updates.at(-1)!.state.phase).toBe("recording");
    expect(browser.asked.slice(askedWhenPaused)).toEqual([
      { kind: "reportInteractions", on: true },
      { kind: "holdInputs", on: true },
    ]);
    // No Visit was started, and the earlier entry is still there.
    expect(updates.at(-1)!.state.visits).toHaveLength(1);
    expect(idsOf(updates.at(-1)!)).toEqual(["interaction_1"]);

    await clickOnce(browser, "input_2", saved);
    await expect
      .poll(() => idsOf(updates.at(-1)!))
      .toEqual(["interaction_1", "interaction_2"]);
    await recorder.send({ type: "finish" });
    const outcome = await recorder.done;

    const text = await readFile(
      join((outcome as { folder: string }).folder, "package.yaml"),
      "utf8"
    );
    expect(text.match(/visitId:/g)).toHaveLength(1);
    expect(text.match(/kind: interaction/g)).toHaveLength(2);
    // Every update had a counter above the one before it.
    const revisions = updates.map((update) => update.revision);
    expect(revisions).toEqual([...new Set(revisions)].sort((a, b) => a - b));
  });

  it("is ignored unless the recorder is paused", async () => {
    const { recorder } = await start();

    await expect(recorder.send({ type: "continue" })).resolves.toBe("ignored");
    await recorder.send({ type: "record" });
    await expect(recorder.send({ type: "continue" })).resolves.toBe("ignored");

    recorder.end();
    await recorder.done;
  });
});

describe("Clear", () => {
  it("leaves no entry behind and returns to not recording, in one update", async () => {
    const { recorder, browser } = await start();
    browser.showPage(idle);
    const updates: RecorderUpdate[] = [];
    recorder.subscribe((update) => updates.push(update));
    await recorder.send({ type: "record" });
    await clickOnce(browser, "input_1", saved);
    await expect.poll(() => idsOf(updates.at(-1)!)).toEqual(["interaction_1"]);

    await expect(recorder.send({ type: "clear" })).resolves.toBe("applied");
    await expect.poll(() => updates.at(-1)!.state.phase).toBe("notRecording");

    expect(updates.at(-1)!.state).toEqual({
      phase: "notRecording",
      visits: [],
    });
    // "Not recording" was never shown with the old entries still in it.
    expect(
      updates.filter(
        ({ state }) => state.phase === "notRecording" && state.visits.length > 0
      )
    ).toEqual([]);
    expect(browser.asked.at(-1)).toEqual({
      kind: "reportInteractions",
      on: false,
    });

    // The next recording is a recording of its own.
    await recorder.send({ type: "record" });
    expect(updates.at(-1)!.state.visits).toEqual([
      {
        visitId: "visit_1",
        url: "http://shop.test/",
        cause: "initial",
        entries: [],
      },
    ]);
    await clickOnce(browser, "input_2");
    await recorder.send({ type: "finish" });
    const outcome = await recorder.done;
    const text = await readFile(
      join((outcome as { folder: string }).folder, "package.yaml"),
      "utf8"
    );
    expect(text.match(/kind: interaction/g)).toHaveLength(1);
    expect(text).toContain("id: interaction_1");
  });

  it("clears a paused recorder at once", async () => {
    const { recorder, browser } = await start();
    browser.showPage(idle);
    const updates: RecorderUpdate[] = [];
    recorder.subscribe((update) => updates.push(update));
    await recorder.send({ type: "record" });
    await clickOnce(browser, "input_1");
    await recorder.send({ type: "stop" });
    await expect.poll(() => updates.at(-1)!.state.phase).toBe("paused");

    await expect(recorder.send({ type: "clear" })).resolves.toBe("applied");

    expect(updates.at(-1)!.state).toEqual({
      phase: "notRecording",
      visits: [],
    });
    recorder.end();
    await expect(recorder.done).resolves.toEqual({ kind: "empty" });
    await expect(readdir(recordings())).rejects.toThrow(/ENOENT/);
  });

  it("ends with 'empty' and writes nothing when the recorder is ended from outside while it clears", async () => {
    const { recorder, browser } = await start();
    browser.showPage(idle);
    const updates: RecorderUpdate[] = [];
    recorder.subscribe((update) => updates.push(update));
    await recorder.send({ type: "record" });
    await clickOnce(browser, "input_1");
    await expect.poll(() => idsOf(updates.at(-1)!)).toEqual(["interaction_1"]);
    browser.holdSnapshots();

    await recorder.send({ type: "clear" });
    recorder.end();
    browser.releaseSnapshots();

    await expect(recorder.done).resolves.toEqual({ kind: "empty" });
    expect(updates.at(-1)!.state).toEqual({
      phase: "ended",
      outcome: { kind: "empty" },
      visits: [],
    });
    await expect(readdir(recordings())).rejects.toThrow(/ENOENT/);
  });

  it("is ignored when nothing is recorded", async () => {
    const { recorder } = await start();

    await expect(recorder.send({ type: "clear" })).resolves.toBe("ignored");

    recorder.end();
    await recorder.done;
  });
});

// What the released recorder does: a recording in which Playwright reported
// no Interaction is empty, and no package is written for it.
describe("a started recording with no Interactions", () => {
  it("ends with 'empty' on Finish: no package is written, and an earlier 'latest' is left as it was", async () => {
    await mkdir(recordings(), { recursive: true });
    await writeFile(join(recordings(), "latest.yaml"), "earlier");
    const { recorder, browser } = await start();
    const phases = phasesOf(recorder);
    await recorder.send({ type: "record" });
    // The page changes by itself, and nobody does anything on it.
    browser.showPage(saved);

    await expect(recorder.send({ type: "finish" })).resolves.toBe("applied");

    await expect(recorder.done).resolves.toEqual({ kind: "empty" });
    expect(phases.at(-1)).toBe("ended");
    expect(await readdir(recordings())).toEqual(["latest.yaml"]);
    expect(await readFile(join(recordings(), "latest.yaml"), "utf8")).toBe(
      "earlier"
    );
  });

  it("ends with 'empty' when it is ended from outside", async () => {
    const { recorder } = await start();
    await recorder.send({ type: "record" });

    recorder.end();

    await expect(recorder.done).resolves.toEqual({ kind: "empty" });
    await expect(readdir(recordings())).rejects.toThrow(/ENOENT/);
  });

  it("ends with 'empty' when its only click was never reported by Playwright", async () => {
    const { recorder, browser } = await start();
    await recorder.send({ type: "record" });
    browser.holdClick();
    await browser.asks({
      kind: "waitForSettled",
      page: "page_1",
      input: "input_1",
    });
    browser.settle();

    await recorder.send({ type: "finish" });
    await browser.asks({
      kind: "takeSnapshot",
      snapshot: "snapshot_3",
      page: "page_1",
    });
    await browser.advanceTime(5_000);

    await expect(recorder.done).resolves.toEqual({ kind: "empty" });
  });
});
