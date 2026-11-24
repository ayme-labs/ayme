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
    const { recorder, browser, endWithin } = await startScriptedRecorder({
      projectDir,
      url: "http://shop.test/",
      window: { folder: windowFolder },
    });
    const window = new RecorderWindow(page);
    await window.open(recorder.windowUrl!);
    await use({ browser, window, finished: () => recorder.done });
    // The recorder's clock stands still unless it is moved: an end waits
    // out whatever a test left unanswered on that clock, never on the
    // test's own time.
    await endWithin(600_000);
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

/** The entries of the window's first Visit, once it shows `count`. */
async function entriesOf(window: RecorderWindow, count: number) {
  await expect(window.timeline.visitSections).not.toHaveCount(0);
  const [visit] = await window.timeline.visits();
  await expect(visit!.entryCards).toHaveCount(count);
  return visit!.entries();
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
  await window.controls.recordButton.click();
  await expect(window.controls.stopButton).toBeEnabled();
  await clickAddItem(browser, "input_1");
  await clickAddItem(browser, "input_2");
  await entriesOf(window, 2);
  await window.controls.stopButton.click();
  await expect(window.controls.continueButton).toBeEnabled();
  return entriesOf(window, 2);
}

test.describe("reviewing the recording in the recorder window", () => {
  test("offers Discard and Restore on entries while recording and while paused, with no gap between", async ({
    recording: { browser, window },
  }) => {
    browser.showPage(idle);
    await window.controls.recordButton.click();
    await expect(window.controls.stopButton).toBeEnabled();
    await clickAddItem(browser, "input_1");
    const [entry] = await entriesOf(window, 1);
    await expect(entry!.title).toHaveText("Click");
    // While recording, with no Stop: quiet until the entry is hovered.
    await expect(entry!.discardButton).toHaveCount(1);
    await expect(entry!.restoreButton).toHaveCount(0);
    await expect(entry!.discardButton).toHaveCSS("opacity", "0");
    await entry!.title.hover();
    await expect(entry!.discardButton).toHaveCSS("opacity", "1");

    await entry!.discard();
    await expect.poll(() => entry!.looksDiscarded()).toBe(true);
    await expect(window.controls.stopButton).toBeEnabled();
    await entry!.restoreButton.click();
    await expect.poll(() => entry!.looksDiscarded()).toBe(false);

    // Through Stop's wrap-up, which waits here for the pages' confirmation.
    browser.holdConfirmations();
    await window.controls.stopButton.click();
    await expect(window.controls.stopButton).toBeDisabled();
    await expect(entry!.discardButton).toHaveCount(1);
    browser.releaseConfirmations();
    await expect(window.controls.continueButton).toBeEnabled();
    await expect(entry!.discardButton).toHaveCount(1);

    await window.controls.continueButton.click();
    await expect(window.controls.stopButton).toBeEnabled();
    await expect(entry!.discardButton).toHaveCount(1);
  });

  test("strikes a discarded entry through in its place, hides its changes, and offers to put it back", async ({
    recording,
  }) => {
    const [entry, other] = await pausedWithTwoClicks(recording);
    await expect(entry!.whatChangedList).toBeVisible();
    expect(await entry!.looksDiscarded()).toBe(false);

    await entry!.discard();

    await expect(entry!.title).toHaveText("Click");
    await expect.poll(() => entry!.looksDiscarded()).toBe(true);
    await expect(entry!.whatChangedList).toHaveCount(0);
    await expect(entry!.discardButton).toHaveCount(0);
    await expect(entry!.restoreButton).toBeVisible();
    // The other entry is untouched.
    expect(await other!.looksDiscarded()).toBe(false);

    await entry!.restoreButton.click();

    await expect(entry!.restoreButton).toHaveCount(0);
    await expect.poll(() => entry!.looksDiscarded()).toBe(false);
    await expect
      .poll(() => entry!.whatChanged())
      .toEqual([{ element: "list “Cart”", effect: "appeared" }]);
  });

  test("keeps a decision through Continue and a reload of the window, and drops it on Clear", async ({
    recording,
  }) => {
    const { window } = recording;
    const [first, second] = await pausedWithTwoClicks(recording);
    await second!.discard();

    await window.reload();
    await expect.poll(() => second!.looksDiscarded()).toBe(true);
    expect(await first!.looksDiscarded()).toBe(false);

    await window.controls.continueButton.click();
    await expect(window.controls.stopButton).toBeEnabled();
    expect(await second!.looksDiscarded()).toBe(true);
    await window.controls.stopButton.click();
    await expect(window.controls.continueButton).toBeEnabled();
    expect(await second!.looksDiscarded()).toBe(true);

    await window.controls.clearButton.click();
    await expect(window.controls.recordButton).toBeEnabled();
    await expect(window.timeline.visitSections).toHaveCount(0);
    await window.controls.recordButton.click();
    await expect(window.controls.stopButton).toBeEnabled();
    await entriesOf(window, 0);
  });

  test("saves the decisions when Finish is pressed, and a recording in which everything was discarded still saves", async ({
    recording,
  }) => {
    const { window, finished } = recording;
    const [first, second] = await pausedWithTwoClicks(recording);
    await first!.discard();
    await second!.discard();

    await window.controls.finishButton.click();
    const outcome = await finished();

    expect(outcome.kind).toBe("saved");
    await expect(window.controls.status).toHaveText(/^Saved /);
    // Review is over: the entries stay as they were, and nothing is offered.
    expect(await first!.looksDiscarded()).toBe(true);
    await expect(first!.restoreButton).toHaveCount(0);
    if (outcome.kind !== "saved") return;
    const text = await readFile(join(outcome.folder, "package.yaml"), "utf8");
    expect(text.match(/discarded: true/g)).toHaveLength(2);
  });
});
