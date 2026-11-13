import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { RecorderUpdate, RecordingOutcome } from "./index";
import { startScriptedRecorder, type ScriptedBrowser } from "./testing";

// Ticket #1279: leaving an entry out of the recording while paused, and
// putting it back, on the scripted browser: what the handle answers and
// shows, and what the package says.

let projectDir: string;
beforeEach(async () => {
  projectDir = await mkdtemp(join(tmpdir(), "ayme-recorder-review-"));
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

const entriesOf = (update: RecorderUpdate) =>
  update.state.visits.flatMap((visit) => visit.entries);
/** Each entry's identity, marked when it is discarded. */
const shownAs = (update: RecorderUpdate) =>
  entriesOf(update).map((entry) =>
    entry.discarded ? `${entry.id} (discarded)` : entry.id
  );

/** A recorder with two clicks recorded, and paused: `interaction_1` saved
 * something, and `interaction_2` changed nothing. */
async function pausedWithTwoClicks() {
  const { recorder, browser } = await start();
  browser.showPage(idle);
  const updates: RecorderUpdate[] = [];
  recorder.subscribe((update) => updates.push(update));
  await recorder.send({ type: "record" });
  await clickOnce(browser, "input_1", saved);
  await clickOnce(browser, "input_2", saved);
  await expect.poll(() => entriesOf(updates.at(-1)!).length).toBe(2);
  await recorder.send({ type: "stop" });
  await expect.poll(() => updates.at(-1)!.state.phase).toBe("paused");
  const latest = () => updates.at(-1)!;
  return { recorder, browser, latest };
}

const packageOf = async (outcome: RecordingOutcome) => {
  if (outcome.kind !== "saved") throw new Error("Nothing was saved.");
  return readFile(join(outcome.folder, "package.yaml"), "utf8");
};

describe("discard and restore", () => {
  it("are offered while paused and in no other phase, and answered 'ignored' elsewhere", async () => {
    const { recorder, browser } = await start();
    browser.showPage(idle);
    const updates: RecorderUpdate[] = [];
    recorder.subscribe((update) => updates.push(update));
    await expect(
      recorder.send({ type: "discard", entry: "interaction_1" })
    ).resolves.toBe("ignored");

    await recorder.send({ type: "record" });
    await clickOnce(browser, "input_1", saved);
    await expect.poll(() => entriesOf(updates.at(-1)!).length).toBe(1);
    expect(updates.at(-1)!.state.commands).not.toContain("discard");
    await expect(
      recorder.send({ type: "discard", entry: "interaction_1" })
    ).resolves.toBe("ignored");
    await expect(
      recorder.send({ type: "restore", entry: "interaction_1" })
    ).resolves.toBe("ignored");
    expect(shownAs(updates.at(-1)!)).toEqual(["interaction_1"]);

    await recorder.send({ type: "stop" });
    await expect.poll(() => updates.at(-1)!.state.phase).toBe("paused");
    expect(updates.at(-1)!.state.commands).toEqual([
      "finish",
      "continue",
      "clear",
      "discard",
      "restore",
      "highlight",
      "clearHighlight",
    ]);
    await expect(
      recorder.send({ type: "discard", entry: "interaction_1" })
    ).resolves.toBe("applied");
    expect(shownAs(updates.at(-1)!)).toEqual(["interaction_1 (discarded)"]);

    await expect(
      recorder.send({ type: "restore", entry: "interaction_1" })
    ).resolves.toBe("applied");
    expect(shownAs(updates.at(-1)!)).toEqual(["interaction_1"]);
    recorder.end();
    await recorder.done;
  });

  it("show a discarded entry in its place, with what it changed, in one update", async () => {
    const { recorder, latest } = await pausedWithTwoClicks();
    const before = latest();

    await recorder.send({ type: "discard", entry: "interaction_1" });

    expect(latest().revision).toBe(before.revision + 1);
    expect(shownAs(latest())).toEqual([
      "interaction_1 (discarded)",
      "interaction_2",
    ]);
    expect(entriesOf(latest())[0]).toMatchObject({
      changeTree: entriesOf(before)[0]!.changeTree,
    });
    recorder.end();
    await recorder.done;
  });

  it("survive Continue: a decision made while paused is still there after the recorder goes on, and after it pauses again", async () => {
    const { recorder, browser, latest } = await pausedWithTwoClicks();
    await recorder.send({ type: "discard", entry: "interaction_2" });

    await recorder.send({ type: "continue" });
    await expect.poll(() => latest().state.phase).toBe("recording");
    expect(shownAs(latest())).toEqual([
      "interaction_1",
      "interaction_2 (discarded)",
    ]);
    // Nothing can be decided while recording.
    await expect(
      recorder.send({ type: "restore", entry: "interaction_2" })
    ).resolves.toBe("ignored");

    await clickOnce(browser, "input_3", saved);
    await recorder.send({ type: "stop" });
    await expect.poll(() => latest().state.phase).toBe("paused");
    expect(shownAs(latest())).toEqual([
      "interaction_1",
      "interaction_2 (discarded)",
      "interaction_3",
    ]);
    recorder.end();
    await recorder.done;
  });

  it("are all dropped by Clear: the next recording starts with none", async () => {
    const { recorder, browser, latest } = await pausedWithTwoClicks();
    await recorder.send({ type: "discard", entry: "interaction_1" });

    await recorder.send({ type: "clear" });
    await expect.poll(() => latest().state.phase).toBe("notRecording");
    await recorder.send({ type: "record" });
    // The browser goes on counting the clicks it held.
    await clickOnce(browser, "input_3", saved);
    await expect.poll(() => entriesOf(latest()).length).toBe(1);
    await recorder.send({ type: "stop" });
    await expect.poll(() => latest().state.phase).toBe("paused");

    // The new recording has an `interaction_1` of its own, and it is kept.
    expect(shownAs(latest())).toEqual(["interaction_1"]);
    await recorder.send({ type: "finish" });
    expect(await packageOf(await recorder.done)).not.toContain("discarded");
  });

  it("are saved by Finish into the package, which ends review", async () => {
    const { recorder, latest } = await pausedWithTwoClicks();
    await recorder.send({ type: "discard", entry: "interaction_1" });

    await expect(recorder.send({ type: "finish" })).resolves.toBe("applied");
    const outcome = await recorder.done;

    expect(outcome.kind).toBe("saved");
    const text = await packageOf(outcome);
    expect(text).toContain(
      [
        `      - kind: interaction`,
        `        timestamp: 2`,
        `        discarded: true`,
        `        interaction:`,
        `          id: interaction_1`,
        `          type: click`,
        `      - kind: interaction`,
      ].join("\n")
    );
    // The one that was kept is written whole.
    expect(text).toContain(`          targetSelector: internal:role=button`);
    expect(text.match(/discarded: true/g)).toHaveLength(1);
    // Review is over: nothing can be decided any more.
    await expect(
      recorder.send({ type: "restore", entry: "interaction_1" })
    ).resolves.toBe("ignored");
    expect(latest().state.phase).toBe("ended");
  });

  it("leave a package when everything was discarded; a recording of nothing still ends 'empty'", async () => {
    const { recorder } = await pausedWithTwoClicks();
    await recorder.send({ type: "discard", entry: "interaction_1" });
    await recorder.send({ type: "discard", entry: "interaction_2" });

    await recorder.send({ type: "finish" });
    const outcome = await recorder.done;

    expect(outcome.kind).toBe("saved");
    const text = await packageOf(outcome);
    expect(text.match(/discarded: true/g)).toHaveLength(2);
    expect(text).not.toContain("changeTree:\n        ");

    const nothing = await start();
    await nothing.recorder.send({ type: "record" });
    await nothing.recorder.send({ type: "finish" });
    await expect(nothing.recorder.done).resolves.toEqual({ kind: "empty" });
  });

  it("are saved when the recorder is ended from outside while paused", async () => {
    const { recorder } = await pausedWithTwoClicks();
    await recorder.send({ type: "discard", entry: "interaction_2" });

    recorder.end();
    const outcome = await recorder.done;

    expect(outcome.kind).toBe("saved");
    expect((await packageOf(outcome)).match(/discarded: true/g)).toHaveLength(
      1
    );
  });
});
