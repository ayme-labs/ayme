import { mkdir, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import type { RecordingOutcome } from "@ayme-dev/recorder";
import {
  startScriptedRecorder,
  type ScriptedBrowser,
} from "@ayme-dev/recorder/testing";
import { RecorderWindow } from "@ayme-dev/recorder-window/testing";

import { expect, test as base } from "./fixtures";

// Ticket #1279: leaving an entry out of the recording, and putting it back,
// in the recorder window: the real server of a recorder on a scripted
// browser, driven through the window's page objects as a person would.

const windowFolder = dirname(
  createRequire(import.meta.url).resolve(
    "@ayme-dev/recorder-window/window/index.html"
  )
);

const test = base.extend<{
  recording: {
    browser: ScriptedBrowser;
    window: RecorderWindow;
    finished: () => Promise<RecordingOutcome>;
  };
}>({
  recording: async ({ page }, use, testInfo) => {
    const projectDir = testInfo.outputPath("project");
    await mkdir(projectDir, { recursive: true });
    const { recorder, browser } = await startScriptedRecorder({
      projectDir,
      url: "http://shop.test/",
      window: { folder: windowFolder },
    });
    const window = new RecorderWindow(page);
    await window.open(recorder.windowUrl!);
    await use({ browser, window, finished: () => recorder.done });
    recorder.end();
    await recorder.done;
  },
});

const idle = [`- generic [ref=e1]:`, `  - button "Add item" [ref=e2]`].join(
  "\n"
);
const added = [
  `- generic [ref=e1]:`,
  `  - button "Add item" [ref=e2]`,
  `  - list "Cart" [ref=e3]:`,
  `    - listitem [ref=e4]: Milk`,
].join("\n");

async function clickAddItem(browser: ScriptedBrowser, input: string) {
  browser.holdClick();
  await browser.asks({ kind: "waitForSettled", page: "page_1", input });
  browser.showPage(added);
  browser.settle();
  browser.report({
    type: "click",
    selector: 'internal:role=button[name="Add item"i]',
    target: { ref: "e2", tree: idle },
    values: { button: "left", modifiers: 0, clickCount: 1 },
  });
}

/** Two clicks recorded, and the recorder paused. */
async function pausedWithTwoClicks({
  browser,
  window,
}: {
  browser: ScriptedBrowser;
  window: RecorderWindow;
}) {
  browser.showPage(idle);
  await window.controls.press("Record");
  await expect(window.controls.status).toHaveText("Recording");
  await clickAddItem(browser, "input_1");
  await clickAddItem(browser, "input_2");
  await expect(window.timeline.visit(0).entries).toHaveCount(2);
  await window.controls.press("Stop");
  await expect(window.controls.status).toHaveText("Paused");
}

test.describe("reviewing the recording in the recorder window", () => {
  test("offers Discard and Restore on entries only while paused", async ({
    recording: { browser, window },
  }) => {
    browser.showPage(idle);
    await window.controls.press("Record");
    await expect(window.controls.status).toHaveText("Recording");
    await clickAddItem(browser, "input_1");
    const entry = window.timeline.visit(0).entry(0);
    await expect(entry.title).toHaveText("Click");
    await expect(entry.discardButton).toHaveCount(0);

    await window.controls.press("Stop");
    await expect(window.controls.status).toHaveText("Paused");
    await expect(entry.discardButton).toBeVisible();
    await expect(entry.restoreButton).toHaveCount(0);

    await window.controls.press("Continue");
    await expect(window.controls.status).toHaveText("Recording");
    await expect(entry.discardButton).toHaveCount(0);
  });

  test("dims a discarded entry in its place, hides its changes, and offers to put it back", async ({
    recording,
  }) => {
    const { window } = recording;
    await pausedWithTwoClicks(recording);
    const visit = window.timeline.visit(0);
    const entry = visit.entry(0);
    await expect(entry.changes).toBeVisible();
    expect(await entry.isDimmed()).toBe(false);

    await entry.discard();

    await expect(visit.entries).toHaveCount(2);
    await expect(entry.title).toHaveText("Click");
    await expect(entry.discardedMark).toBeVisible();
    expect(await entry.isDimmed()).toBe(true);
    await expect(entry.changes).toHaveCount(0);
    await expect(entry.discardButton).toHaveCount(0);
    await expect(entry.restoreButton).toBeVisible();
    // The other entry is untouched.
    await expect(visit.entry(1).discardedMark).toHaveCount(0);

    await entry.restore();

    await expect(entry.discardedMark).toHaveCount(0);
    expect(await entry.isDimmed()).toBe(false);
    await expect(entry.restoreButton).toHaveCount(0);
    await expect
      .poll(() => entry.changeRows())
      .toEqual([{ element: 'list "Cart"', effect: "appeared" }]);
  });

  test("keeps a decision through Continue and a reload of the window, and drops it on Clear", async ({
    recording,
  }) => {
    const { window } = recording;
    await pausedWithTwoClicks(recording);
    const visit = window.timeline.visit(0);
    await visit.entry(1).discard();
    await expect(visit.entry(1).discardedMark).toBeVisible();

    await window.reload();
    await expect(visit.entry(1).discardedMark).toBeVisible();
    await expect(visit.entry(0).discardedMark).toHaveCount(0);

    await window.controls.press("Continue");
    await expect(window.controls.status).toHaveText("Recording");
    await expect(visit.entry(1).discardedMark).toBeVisible();
    await window.controls.press("Stop");
    await expect(window.controls.status).toHaveText("Paused");
    await expect(visit.entry(1).discardedMark).toBeVisible();

    await window.controls.press("Clear");
    await expect(window.controls.status).toHaveText("Not recording");
    await expect(window.timeline.visits).toHaveCount(0);
    await window.controls.press("Record");
    await expect(window.controls.status).toHaveText("Recording");
    await expect(window.timeline.visit(0).entries).toHaveCount(0);
  });

  test("saves the decisions when Finish is pressed, and a recording in which everything was discarded still saves", async ({
    recording,
  }) => {
    const { window, finished } = recording;
    await pausedWithTwoClicks(recording);
    const visit = window.timeline.visit(0);
    await visit.entry(0).discard();
    await visit.entry(1).discard();

    await window.controls.press("Finish");
    const outcome = await finished();

    expect(outcome.kind).toBe("saved");
    await expect(window.controls.status).toHaveText(/^Saved /);
    // Review is over: the entries stay as they were, and nothing is offered.
    await expect(visit.entry(0).discardedMark).toBeVisible();
    await expect(visit.entry(0).restoreButton).toHaveCount(0);
    if (outcome.kind !== "saved") return;
    const text = await readFile(join(outcome.folder, "package.yaml"), "utf8");
    expect(text.match(/discarded: true/g)).toHaveLength(2);
  });
});
