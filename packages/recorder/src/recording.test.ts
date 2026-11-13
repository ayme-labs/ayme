import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { RecorderUpdate } from "./index";
import {
  SCRIPTED_TRACE,
  startScriptedRecorder,
  type ScriptedBrowser,
} from "./testing";

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
  `traceActionPoints:`,
  `  - interactionId: interaction_1`,
  `    pageId: page_1`,
  `    beforeSnapshotId: "10"`,
  `    afterSnapshotId: "20"`,
  `    startedAt: 2`,
  `    endedAt: 3`,
  ``,
].join("\n");

/** One reported click, from held to its "after". A recording needs one to
 * be saved: without an Interaction it is empty. */
async function recordClick(browser: ScriptedBrowser, input = "input_1") {
  browser.holdClick();
  await browser.asks({ kind: "waitForSettled", page: "page_1", input });
  browser.settle();
  browser.report(click);
}

describe("a recording", () => {
  it("starts on Record: Playwright reports Interactions and the pages hold inputs back", async () => {
    const { recorder, browser } = await start();
    const updates: RecorderUpdate[] = [];
    recorder.subscribe((update) => updates.push(update));

    await expect(recorder.send({ type: "record" })).resolves.toBe("applied");

    // Pressing Record starts a Visit for the current page. Once Record is
    // answered, Assert visibility applies too.
    expect(updates.at(-1)).toEqual({
      revision: 4,
      state: {
        phase: "recording",
        visits: [
          {
            visitId: "visit_1",
            url: "http://shop.test/",
            cause: "initial",
            entries: [],
          },
        ],
        commands: ["finish", "stop", "clear", "assertVisibility"],
        warnings: [],
      },
    });
    expect(browser.asked).toEqual([
      { kind: "startTrace" },
      { kind: "reportInteractions", on: true },
      { kind: "holdInputs", on: true },
    ]);
  });

  it("takes a held click's 'before', passes it on, and takes its 'after' once the page is settled", async () => {
    const { recorder, browser } = await start();
    await recorder.send({ type: "record" });

    browser.holdClick();
    await browser.asks(waitForSettled);
    expect(browser.asked.slice(3)).toEqual([
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

  it("tells a subscriber each entry as it is produced, with a growing revision", async () => {
    const { recorder, browser } = await start();
    browser.showPage(idle);
    await recorder.send({ type: "record" });
    const updates: RecorderUpdate[] = [];
    recorder.subscribe((update) => updates.push(update));
    const entriesOf = (update: RecorderUpdate) =>
      update.state.visits.flatMap((visit) => visit.entries);
    expect(updates.map(entriesOf)).toEqual([[]]);

    // A click, and what it changed.
    browser.holdClick();
    await browser.asks(waitForSettled);
    browser.showPage(saved);
    browser.settle();
    browser.report(click);
    const interaction = {
      kind: "interaction",
      id: "interaction_1",
      timestamp: 2,
      interaction: {
        id: "interaction_1",
        type: "click",
        targetRef: "e2",
        targetSelector: 'internal:role=button[name="Save"i]',
        button: "left",
        modifiers: 0,
        clickCount: 1,
      },
      changeTree: [`- [ref=e1]:`, `  - <added> [ref=e3] status: Saved`].join(
        "\n"
      ),
    };
    await expect.poll(() => entriesOf(updates.at(-1)!)).toEqual([interaction]);
    expect(updates.at(-1)!.state.phase).toBe("recording");

    // What the page changed by itself afterwards is told at Finish.
    browser.showPage(idle);
    await recorder.send({ type: "finish" });
    await recorder.done;

    expect(entriesOf(updates.at(-1)!)).toEqual([
      interaction,
      {
        kind: "change",
        id: "change_1",
        timestamp: 4,
        changeTree: [
          `- [ref=e1]:`,
          `  - <removed> [ref=e3] status: Saved`,
        ].join("\n"),
      },
    ]);
    const revisions = updates.map((update) => update.revision);
    expect(revisions).toEqual([...revisions].sort((a, b) => a - b));
    expect(new Set(revisions).size).toBe(revisions.length);
    // A late subscriber's first message is the full state.
    const late: RecorderUpdate[] = [];
    recorder.subscribe((update) => late.push(update));
    expect(late).toEqual([updates.at(-1)]);
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
        `tracePath: .ayme/recordings/${recordingId}/trace.zip`,
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
    // The recording's trace is beside the package.
    expect((await readdir(folder)).sort()).toEqual([
      "package.yaml",
      "trace.zip",
    ]);
    await expect(readFile(join(folder, "trace.zip"), "utf8")).resolves.toBe(
      SCRIPTED_TRACE
    );
  });

  it("replaces an earlier 'latest', and the semantic one of the released recorder", async () => {
    const recordings = join(projectDir, ".ayme", "recordings");
    const first = await start();
    await first.recorder.send({ type: "record" });
    await recordClick(first.browser);
    await first.recorder.send({ type: "finish" });
    await first.recorder.done;
    await writeFile(join(recordings, "latest.json"), "{}");
    await writeFile(join(recordings, "latest.yaml"), "older");

    const second = await start();
    await second.recorder.send({ type: "record" });
    await recordClick(second.browser);
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

  it("writes a click that leaves the page in its Visit, with no Change Tree, and starts the next Visit from the page it led to", async () => {
    const { recorder, browser } = await start();
    browser.showPage(idle);
    await recorder.send({ type: "record" });
    browser.holdClick();
    await browser.asks(waitForSettled);
    browser.goTo("http://shop.test/cart");
    browser.showPage(`- heading "Cart" [level=1] [ref=f1e1]`);
    browser.settle();
    browser.report(click);

    await recorder.send({ type: "finish" });
    const outcome = await recorder.done;
    const text = await readFile(
      join((outcome as { folder: string }).folder, "package.yaml"),
      "utf8"
    );
    expect(text).toContain(
      [
        `          clickCount: 1`,
        `  - visitId: visit_2`,
        `    url: http://shop.test/cart`,
        `    cause: navigate`,
        `    baselineTree:`,
        `      - [ref=f1e1] heading "Cart" [level=1]`,
        `    timelineEntries: []`,
        `traceActionPoints:`,
        `  - interactionId: interaction_1`,
        `    pageId: page_1`,
        // A click that leaves the page has its "before" only.
        `    beforeSnapshotId: "10"`,
        `    startedAt: 2`,
        `    endedAt: 3`,
        ``,
      ].join("\n")
    );
  });

  it("drops a click held when its page goes away, never passes it on to the page after, and still saves", async () => {
    const { recorder, browser } = await start();
    browser.showPage(idle);
    await recorder.send({ type: "record" });
    browser.holdClick();
    await browser.asks(waitForSettled);
    browser.showPage(saved);
    browser.settle();
    browser.report(click);
    await browser.asks({
      kind: "takeSnapshot",
      snapshot: "snapshot_2",
      page: "page_1",
    });
    // The page is slow to be read, and goes elsewhere meanwhile.
    browser.holdSnapshots();
    browser.holdClick();
    await browser.asks({
      kind: "takeSnapshot",
      snapshot: "snapshot_3",
      page: "page_1",
    });
    browser.goTo("http://shop.test/cart");
    browser.releaseSnapshots();
    browser.report(click);

    await expect(recorder.send({ type: "finish" })).resolves.toBe("applied");
    const outcome = await recorder.done;
    expect(browser.passedOn).toEqual(["input_1"]);
    expect(outcome.kind).toBe("saved");
    const text = await readFile(
      join((outcome as { folder: string }).folder, "package.yaml"),
      "utf8"
    );
    expect(text.match(/kind: interaction/g)).toHaveLength(1);
  });

  it("takes Finish while a click's 'before' snapshot is outstanding: it wraps up, and the time limit runs", async () => {
    const { recorder, browser } = await start();
    await recorder.send({ type: "record" });
    const phases: string[] = [];
    recorder.subscribe(({ state }) => {
      // A phase is told again with each entry: once is enough here.
      if (phases.at(-1) !== state.phase) phases.push(state.phase);
    });
    // The page cannot be read: the snapshot the click waits for never comes.
    browser.holdSnapshots();
    browser.holdClick();
    await browser.asks({
      kind: "takeSnapshot",
      snapshot: "snapshot_1",
      page: "page_1",
    });

    await expect(recorder.send({ type: "finish" })).resolves.toBe("applied");
    expect(phases).toEqual(["recording", "wrappingUp"]);

    await browser.advanceTime(5_000);
    // No page was ever read, so there is nothing to write.
    await expect(recorder.done).resolves.toEqual({ kind: "empty" });
    expect(phases).toEqual(["recording", "wrappingUp", "saving", "ended"]);
  });

  it("shows the wrap-up and the save, and lets the browser go only after the package is written", async () => {
    const { recorder, browser } = await start();
    const phases: string[] = [];
    recorder.subscribe(({ state }) => {
      // A phase is told again with each entry: once is enough here.
      if (phases.at(-1) !== state.phase) phases.push(state.phase);
    });
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
    const { recorder, browser } = await start();
    await recorder.send({ type: "record" });
    await recordClick(browser);

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
    await recordClick(browser);
    browser.holdClick();
    await browser.asks({ ...waitForSettled, input: "input_2" });
    browser.settle();
    // Playwright never reports this second click.
    const phases: string[] = [];
    recorder.subscribe(({ state }) => {
      // A phase is told again with each entry: once is enough here.
      if (phases.at(-1) !== state.phase) phases.push(state.phase);
    });

    await recorder.send({ type: "finish" });
    // Everything else is done: the last snapshot is in.
    await browser.asks({
      kind: "takeSnapshot",
      snapshot: "snapshot_5",
      page: "page_1",
    });
    await browser.advanceTime(4_999);
    expect(phases).toEqual(["recording", "wrappingUp"]);

    await browser.advanceTime(1);
    const outcome = await recorder.done;

    expect(outcome.kind).toBe("saved");
    expect(
      (
        await readFile(
          join((outcome as { folder: string }).folder, "package.yaml"),
          "utf8"
        )
      ).match(/kind: interaction/g)
    ).toHaveLength(1);
  });

  it("saves a recording that is ended from outside, as Finish does", async () => {
    const { recorder, browser } = await start();
    await recorder.send({ type: "record" });
    await recordClick(browser);

    recorder.end();
    recorder.end();

    await expect(recorder.done).resolves.toEqual({
      kind: "saved",
      folder: join(projectDir, ".ayme", "recordings", recordingId),
    });
  });

  it("ends 'failed' with the reason when the package cannot be written, and still lets the browser go", async () => {
    // The project's `.ayme` is a file: no folder can be made in it.
    await writeFile(join(projectDir, ".ayme"), "");
    const { recorder, browser } = await start();
    const updates: RecorderUpdate[] = [];
    recorder.subscribe((update) => updates.push(update));
    await recorder.send({ type: "record" });
    await recordClick(browser);

    await recorder.send({ type: "finish" });

    const outcome = await recorder.done;
    expect(outcome).toEqual({
      kind: "failed",
      reason: expect.stringMatching(/ENOTDIR|EEXIST/),
    });
    expect(updates.at(-1)!.state).toMatchObject({ phase: "ended", outcome });
    expect(browser.released).toBe(true);
  });
});

describe("a recording's warnings", () => {
  it("tells every subscriber a warning of the browser in the state, once", async () => {
    const { recorder, browser } = await start();
    const updates: RecorderUpdate[] = [];
    recorder.subscribe((update) => updates.push(update));
    const warning = {
      kind: "playwrightUnverified",
      message: "Playwright 1.99.0 is newer than the recorder is verified on.",
    } as const;

    browser.warn(warning);
    browser.warn(warning);

    await expect.poll(() => updates.at(-1)!.state.warnings).toEqual([warning]);
    expect(updates[0]!.state.warnings).toEqual([]);
    recorder.end();
    await recorder.done;
  });

  it("warns when typing is recorded with its 'after' only, as its report's picture is not of a snapshot's shape", async () => {
    const { recorder, browser } = await start();
    browser.showPage(idle);
    await recorder.send({ type: "record" });
    const updates: RecorderUpdate[] = [];
    recorder.subscribe((update) => updates.push(update));

    browser.report({
      type: "fill",
      selector: "#name",
      target: { ref: "e9", tree: `- document [ref=e9]: Save` },
      values: { text: "milk" },
    });
    await browser.asks({
      kind: "waitForSettled",
      page: "page_1",
      input: "reported_1",
    });
    browser.settle();
    await recorder.send({ type: "finish" });
    await recorder.done;

    expect(updates.at(-1)!.state.warnings).toEqual([
      {
        kind: "reportShape",
        message:
          "Playwright's report of interaction_1 does not have the shape of a snapshot: it is recorded with what it changed up to its 'after' only.",
      },
    ]);
  });
});
