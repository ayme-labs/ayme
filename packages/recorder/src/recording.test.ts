import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { RecorderUpdate } from "./index";
import {
  SCRIPTED_TRACE,
  startScriptedRecorder,
  type ScriptedBrowser,
} from "../testing";

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
        commands: [
          "finish",
          "stop",
          "clear",
          "discard",
          "restore",
          "assertVisibility",
          "highlight",
          "clearHighlight",
        ],
        warnings: [],
        url: "http://shop.test/",
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
      targetElement: 'button "Save"',
      changes: [{ kind: "added", element: 'status "Saved"', role: "status" }],
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
        changes: [
          { kind: "removed", element: 'status "Saved"', role: "status" },
        ],
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

    const folder = join(projectDir, "ayme", "recordings", recordingId);
    await expect(recorder.done).resolves.toEqual({ kind: "saved", folder });
    const text = await readFile(join(folder, "package.yaml"), "utf8");
    expect(text).toContain(
      [
        `recordingId: ${recordingId}`,
        `mode: structural`,
        `createdAt: 1970-01-01T00:00:00.000Z`,
        `url: http://shop.test/`,
        `tracePath: ayme/recordings/${recordingId}/trace.zip`,
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
      readFile(join(projectDir, "ayme", "recordings", "latest.yaml"), "utf8")
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
    const recordings = join(projectDir, "ayme", "recordings");
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

  it("keeps typing whose read its page's next document overtook in the Visit of the page it was typed in, with that read (rule 13a)", async () => {
    const { recorder, browser } = await start();
    browser.showPage(
      [`- generic [ref=e1]:`, `  - textbox "Item" [ref=e2]`].join("\n")
    );
    await recorder.send({ type: "record" });
    // The page is read for the typing, and its next document commits
    // before that read is in: the read is of the page it was typed in.
    browser.holdSnapshots();
    browser.report({
      type: "fill",
      selector: 'internal:role=textbox[name="Item"i]',
      target: {
        ref: "e2",
        tree: [`- generic [ref=e1]:`, `  - textbox "Item" [ref=e2]: milk`].join(
          "\n"
        ),
      },
      values: { text: "milk" },
    });
    await browser.asks({
      kind: "takeSnapshot",
      snapshot: "snapshot_1",
      page: "page_1",
    });
    browser.goTo("http://shop.test/cart");
    browser.releaseSnapshots();
    await browser.asks({
      kind: "waitForSettled",
      page: "page_1",
      input: "reported_1",
    });
    browser.showPage(`- heading "Cart" [level=1] [ref=f1e1]`);
    browser.settle();

    await recorder.send({ type: "finish" });
    const outcome = await recorder.done;
    // The typing is the recording's one Interaction: it is saved.
    expect(outcome.kind).toBe("saved");
    expect(
      await readFile(
        join((outcome as { folder: string }).folder, "package.yaml"),
        "utf8"
      )
    ).toContain(
      [
        `  - visitId: visit_1`,
        `    url: http://shop.test/`,
        `    cause: initial`,
        `    baselineTree:`,
        `      - [ref=e1]:`,
        `        - [ref=e2] textbox "Item"`,
        `    timelineEntries:`,
        `      - kind: interaction`,
        `        timestamp: 1`,
        `        interaction:`,
        `          id: interaction_1`,
        `          type: fill`,
        `          targetRef: e2`,
        `          targetSelector: internal:role=textbox[name="Item"i]`,
        `          text: milk`,
        `  - visitId: visit_2`,
        `    url: http://shop.test/cart`,
        `    cause: navigate`,
        `    baselineTree:`,
        `      - [ref=f1e1] heading "Cart" [level=1]`,
        `    timelineEntries: []`,
      ].join("\n")
    );
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
    expect(await readdir(join(projectDir, "ayme", "recordings"))).toEqual([
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
      folder: join(projectDir, "ayme", "recordings", recordingId),
    });
  });

  it("ends 'failed' with the reason when the package cannot be written, and still lets the browser go", async () => {
    // The project's `ayme` is a file: no folder can be made in it.
    await writeFile(join(projectDir, "ayme"), "");
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

// Issue #1525, its third page shape: a page whose read is slow or never
// answers. A held click waits for its "before" only a short time.
describe("a recording on a page that is slow to read", () => {
  const sent = [
    `- generic [ref=e1]:`,
    `  - button "Save" [ref=e2]`,
    `  - status [ref=e3]: Sent`,
  ].join("\n");
  const read = (snapshot: string) =>
    ({ kind: "takeSnapshot", snapshot, page: "page_1" }) as const;

  it("passes a held click on once its read has had three quarters of a second, and records it from the page's last read, with its element and its changes", async () => {
    const { recorder, browser } = await start();
    browser.showPage(idle);
    await recorder.send({ type: "record" });
    browser.holdClick();
    await browser.asks(waitForSettled);
    browser.showPage(saved);
    browser.settle();
    browser.report(click);
    await browser.asks(read("snapshot_2"));

    browser.holdSnapshots();
    browser.holdClick();
    await browser.asks(read("snapshot_3"));
    await browser.advanceTime(749);
    expect(browser.passedOn).toEqual(["input_1"]);
    await browser.advanceTime(1);
    await expect.poll(() => browser.passedOn).toEqual(["input_1", "input_2"]);
    browser.releaseSnapshots();
    await browser.asks({ ...waitForSettled, input: "input_2" });
    browser.showPage(sent);
    browser.settle();
    browser.report(click);
    await recorder.send({ type: "finish" });

    const outcome = await recorder.done;
    const text = await readFile(
      join((outcome as { folder: string }).folder, "package.yaml"),
      "utf8"
    );
    const second = text.split("id: interaction_2")[1]!;
    expect(second).toContain("targetRef: e2");
    expect(second).toContain("<changed> [ref=e3] status: Sent");
    expect(text).toContain(
      [
        `  - interactionId: interaction_2`,
        `    pageId: page_1`,
        `    beforeSnapshotId: "20"`,
      ].join("\n")
    );
  });

  it("records a held click on a page never read without its changes, once its read has had three quarters of a second, and warns that the page could not be read before it", async () => {
    const { recorder, browser } = await start();
    const updates: RecorderUpdate[] = [];
    recorder.subscribe((update) => updates.push(update));
    browser.showPage(idle);
    await recorder.send({ type: "record" });
    browser.holdSnapshots();
    browser.holdClick();
    await browser.asks(read("snapshot_1"));

    await browser.advanceTime(750);
    await expect.poll(() => browser.passedOn).toEqual(["input_1"]);
    await browser.asks(waitForSettled);
    browser.settle();
    await browser.asks(read("snapshot_3"));
    browser.report(click);
    // The read after it, and the wrap-up's last read, never answer either:
    // each has five seconds.
    await browser.advanceTime(5_000);
    await recorder.send({ type: "finish" });
    await browser.advanceTime(5_000);

    const outcome = await recorder.done;
    const text = await readFile(
      join((outcome as { folder: string }).folder, "package.yaml"),
      "utf8"
    );
    expect(text).toContain(
      [
        `          id: interaction_1`,
        `          type: click`,
        `          targetRef: null`,
      ].join("\n")
    );
    expect(text).not.toContain("changeTree:");
    expect(updates.at(-1)!.state.warnings).toContainEqual({
      kind: "pageNotRead",
      message:
        "The page could not be read before interaction_1, so its target is known by its selector only and it has no change list.",
    });
  });

  it("gives the read after a click only the short time once a second click waits on it", async () => {
    const { recorder, browser, endWithin } = await start();
    browser.showPage(idle);
    await recorder.send({ type: "record" });
    browser.holdClick();
    await browser.asks(waitForSettled);
    browser.holdSnapshots();
    browser.settle();
    await browser.asks(read("snapshot_2"));
    await browser.advanceTime(1_000);

    browser.holdClick();
    // The clock moves in small steps, since the time is given as the worker
    // takes the click in, which a test cannot see.
    let moved = 0;
    const asked = JSON.stringify(read("snapshot_3"));
    while (
      !browser.asked.some((request) => JSON.stringify(request) === asked) &&
      moved < 4_000
    ) {
      await browser.advanceTime(50);
      moved += 50;
    }
    // The read after the first click is given up well before its own five
    // seconds: the second click's own read is asked, with the short time.
    expect(moved).toBeGreaterThanOrEqual(750);
    expect(moved).toBeLessThan(4_000);
    await browser.asks(read("snapshot_3"));
    await browser.advanceTime(750);
    await expect.poll(() => browser.passedOn).toEqual(["input_1", "input_2"]);
    await endWithin(65_000);
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

  it("tells two warnings apart by their kind and by their message: each of them is told", async () => {
    const { recorder, browser } = await start();
    const updates: RecorderUpdate[] = [];
    recorder.subscribe((update) => updates.push(update));
    const warnings = [
      { kind: "playwrightUnverified", message: "Playwright 1.99.0 is new." },
      { kind: "playwrightUnverified", message: "Playwright 2.0.0 is new." },
      { kind: "uploadNamesUnknown", message: "Playwright 1.99.0 is new." },
    ] as const;

    for (const warning of warnings) browser.warn(warning);
    browser.warn(warnings[1]);

    await expect.poll(() => updates.at(-1)!.state.warnings).toEqual(warnings);
    recorder.end();
    await recorder.done;
  });

  it("tells a subscriber nothing new when a snapshot is kept that adds no entry", async () => {
    const { recorder, browser, endWithin } = await start();
    browser.showPage(idle);
    await recorder.send({ type: "record" });
    const updates: RecorderUpdate[] = [];
    recorder.subscribe((update) => updates.push(update));

    // The click's "before" is kept, and the click is passed on.
    browser.holdClick();
    await browser.asks(waitForSettled);
    // A command is answered after everything that happened before it.
    await recorder.send({ type: "record" });

    expect(updates).toHaveLength(1);
    // The click still waits for its Settled Page: the end waits that out on
    // the recorder's clock.
    await endWithin(65_000);
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
