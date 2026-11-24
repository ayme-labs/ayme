import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { RecorderState, RecorderUpdate, RecordingOutcome } from "./index";
import { startScriptedRecorder } from "./testing";

// Ticket #1278: Assert visibility through the handle, on the scripted
// browser: what the handle answers and shows, what it asks of the browser,
// and how the package writes an assertion.

let projectDir: string;
beforeEach(async () => {
  projectDir = await mkdtemp(join(tmpdir(), "ayme-recorder-assertion-"));
});
afterEach(() => rm(projectDir, { recursive: true }));

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
const assertVisible = {
  type: "assertVisible",
  selector: 'internal:role=status >> internal:has-text="Saved"i',
  target: null,
  // The picked element's ref in the recorder's own snapshots, which the
  // browser reads when Playwright reports the assertion.
  snapshotTarget: "e3",
  values: {},
};

/** Whether the state shows Assert visibility on. */
const pickingOf = (state: RecorderState) =>
  state.phase === "recording" ? state.picking : undefined;

const packageOf = async (outcome: RecordingOutcome) => {
  if (outcome.kind !== "saved") throw new Error("Nothing was saved.");
  return readFile(join(outcome.folder, "package.yaml"), "utf8");
};

async function recording() {
  const { recorder, browser } = await startScriptedRecorder({
    projectDir,
    url: "http://shop.test/",
  });
  browser.showPage(idle);
  const updates: RecorderUpdate[] = [];
  recorder.subscribe((update) => updates.push(update));
  await recorder.send({ type: "record" });
  return { recorder, browser, latest: () => updates.at(-1)!.state };
}

describe("Assert visibility", () => {
  it("asks Playwright to pick, shows picking once it does, and offers to leave it", async () => {
    const { recorder, browser, latest } = await recording();

    await expect(recorder.send({ type: "assertVisibility" })).resolves.toBe(
      "applied"
    );

    await browser.asks({ kind: "pick", on: true });
    await expect
      .poll(() => latest())
      .toMatchObject({
        phase: "recording",
        picking: true,
      });
    expect(latest().commands).toContain("leaveAssertVisibility");
    expect(latest().commands).not.toContain("assertVisibility");

    await expect(
      recorder.send({ type: "leaveAssertVisibility" })
    ).resolves.toBe("applied");
    await browser.asks({ kind: "pick", on: false });
    await expect.poll(() => pickingOf(latest())).toBeUndefined();
    recorder.end();
    await recorder.done;
  });

  it("records the picked element as an assertion that changed nothing, and what changed before it as a change", async () => {
    const { recorder, browser, latest } = await recording();
    browser.holdClick();
    await browser.asks({
      kind: "waitForSettled",
      page: "page_1",
      input: "input_1",
    });
    browser.settle();
    browser.report(click);
    await expect.poll(() => latest().visits[0]?.entries.length).toBe(1);
    await recorder.send({ type: "assertVisibility" });
    await expect.poll(() => pickingOf(latest())).toBe(true);
    // The page changes by itself before the element is picked.
    browser.showPage(saved);

    browser.pick(assertVisible);

    await expect
      .poll(() => latest().visits[0]?.entries.map((entry) => entry.id))
      .toEqual(["interaction_1", "change_1", "interaction_2"]);
    expect(pickingOf(latest())).toBeUndefined();
    await recorder.send({ type: "finish" });
    const text = await packageOf(await recorder.done);
    expect(text).toContain(
      [
        `      - kind: change`,
        `        timestamp: 4`,
        `        changeTree:`,
        `          - [ref=e1]:`,
        `            - <added> [ref=e3] status: Saved`,
        `      - kind: interaction`,
        `        timestamp: 4`,
        `        interaction:`,
        `          id: interaction_2`,
        `          type: assertVisible`,
        `          targetRef: e3`,
        `          targetSelector: internal:role=status >> internal:has-text="Saved"i`,
        `traceActionPoints:`,
      ].join("\n")
    );
  });

  it("keeps an element picked as its page goes elsewhere in the Visit of the page it was picked on, with the read taken for it (rule 13a)", async () => {
    const { recorder, browser, latest } = await recording();
    browser.showPage(saved);
    await recorder.send({ type: "assertVisibility" });
    await expect.poll(() => pickingOf(latest())).toBe(true);
    // The page is read for the element picked, and its next document
    // commits before that read is in: the read is of the page it was
    // picked on.
    browser.holdSnapshots();
    browser.pick(assertVisible);
    await browser.asks({
      kind: "takeSnapshot",
      snapshot: "snapshot_1",
      page: "page_1",
    });
    browser.goTo("http://shop.test/cart");
    browser.releaseSnapshots();

    await expect
      .poll(() =>
        latest().visits.map((visit) => visit.entries.map((entry) => entry.id))
      )
      .toEqual([["interaction_1"], []]);
    browser.showPage(`- heading "Cart" [level=1] [ref=f1e1]`);
    await recorder.send({ type: "finish" });
    expect(await packageOf(await recorder.done)).toContain(
      [
        `  - visitId: visit_1`,
        `    url: http://shop.test/`,
        `    cause: initial`,
        `    baselineTree:`,
        `      - [ref=e1]:`,
        `        - [ref=e2] button "Save"`,
        `        - [ref=e3] status: Saved`,
        `    timelineEntries:`,
        `      - kind: interaction`,
        `        timestamp: 1`,
        `        interaction:`,
        `          id: interaction_1`,
        `          type: assertVisible`,
        `          targetRef: e3`,
        `          targetSelector: internal:role=status >> internal:has-text="Saved"i`,
        `  - visitId: visit_2`,
        `    url: http://shop.test/cart`,
        `    cause: navigate`,
        `    baselineTree:`,
        `      - [ref=f1e1] heading "Cart" [level=1]`,
        `    timelineEntries: []`,
      ].join("\n")
    );
  });

  it("leaves picking when the recording is stopped", async () => {
    const { recorder, browser, latest } = await recording();
    await recorder.send({ type: "assertVisibility" });
    await expect.poll(() => pickingOf(latest())).toBe(true);

    await recorder.send({ type: "stop" });

    await browser.asks({ kind: "pick", on: false });
    await expect.poll(() => latest().phase).toBe("paused");
    expect(pickingOf(latest())).toBeUndefined();
    recorder.end();
    await recorder.done;
  });
});
