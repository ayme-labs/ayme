import { mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname } from "node:path";
import {
  startScriptedRecorder,
  type ScriptedBrowser,
} from "@ayme-dev/recorder/testing";
import { RecorderWindow } from "@ayme-dev/recorder-window/testing";

import { expect, test as base } from "./fixtures";

// The recorder window, served by the real server of a recorder on a scripted
// browser: the test plays the browser by hand and drives the window through
// its page objects, as a person would use it.

/** The folder of the window's built files, as the CLI finds it. */
const windowFolder = dirname(
  createRequire(import.meta.url).resolve(
    "@ayme-dev/recorder-window/window/index.html"
  )
);

const test = base.extend<{
  /** A recorder on a scripted browser, and its window open in `page`. */
  recording: {
    browser: ScriptedBrowser;
    window: RecorderWindow;
    finished: () => Promise<unknown>;
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
/** The page after "Add item": a list of two items appeared. */
const added = [
  `- generic [ref=e1]:`,
  `  - button "Add item" [ref=e2]`,
  `  - list "Cart" [ref=e3]:`,
  `    - listitem [ref=e4]: Milk`,
  `    - listitem [ref=e5]: Bread`,
].join("\n");

/** Presses Record, and waits until the window says the recorder records. */
async function record(window: RecorderWindow) {
  await window.controls.press("Record");
  await expect(window.controls.status).toHaveText("Recording");
}

/** A person clicks "Add item", and the page shows `after` once it is
 * settled. `input` is the click's place among the clicks held so far. */
async function clickAddItem(
  browser: ScriptedBrowser,
  after: string,
  input = "input_1"
) {
  browser.holdClick();
  await browser.asks({ kind: "waitForSettled", page: "page_1", input });
  browser.showPage(after);
  browser.settle();
  browser.report({
    type: "click",
    selector: 'internal:role=button[name="Add item"i]',
    target: { ref: "e2", tree: idle },
    values: { button: "left", modifiers: 0, clickCount: 1 },
  });
}

test.describe("the recorder window", () => {
  test("opens idle with no Visit; pressing Record starts a Visit for the current page", async ({
    recording: { window },
  }) => {
    await expect(window.controls.status).toHaveText("Not recording");
    await expect(window.timeline.visits).toHaveCount(0);
    await expect(window.timeline.empty).toBeVisible();
    expect(await window.controls.offered()).toEqual(["Record"]);

    await window.controls.press("Record");

    await expect(window.controls.status).toHaveText("Recording");
    await expect(window.timeline.visits).toHaveCount(1);
    await expect(window.timeline.visit(0).heading).toHaveText("Page 1");
    await expect(window.timeline.visit(0).start).toHaveText(
      "Navigated to http://shop.test/"
    );
    expect(await window.controls.offered()).toEqual([
      "Stop",
      "Clear",
      "Finish",
    ]);
  });

  test("shows each entry live, with only the roots of what changed", async ({
    recording: { browser, window },
  }) => {
    browser.showPage(idle);
    await record(window);

    await clickAddItem(browser, added);

    const entry = window.timeline.visit(0).entry(0);
    await expect(entry.title).toHaveText("Click");
    await expect(entry.target).toHaveText('button "Add item"');
    // The list appeared: its items are inside it, and not rows of their own.
    await expect
      .poll(() => entry.changeRows())
      .toEqual([{ element: 'list "Cart"', effect: "appeared" }]);
  });

  test("shows a change that belongs to no Interaction with the next Interaction, and the last one at Finish", async ({
    recording: { browser, window, finished },
  }) => {
    browser.showPage(idle);
    await record(window);
    await clickAddItem(browser, added);
    const visit = window.timeline.visit(0);
    await expect(visit.entries).toHaveCount(1);

    // The page drops Bread on its own: nothing is shown until something
    // else is recorded.
    browser.showPage(added.replace(`\n    - listitem [ref=e5]: Bread`, ""));
    await clickAddItem(browser, added.replace("Milk", "Milk, 2"), "input_2");
    await expect(visit.entries).toHaveCount(3);
    await expect(visit.entry(1).title).toHaveText(
      "Change without an Interaction"
    );
    await expect(visit.entry(1).target).toHaveCount(0);
    expect(await visit.entry(1).changeRows()).toEqual([
      { element: 'listitem "Bread"', effect: "was removed" },
    ]);
    await expect(visit.entry(2).title).toHaveText("Click");

    // And again after the last Interaction: it shows at Finish.
    browser.showPage(idle);
    await window.controls.press("Finish");
    await finished();
    await expect(visit.entries).toHaveCount(4);
    expect(await visit.entry(3).changeRows()).toEqual([
      { element: 'list "Cart"', effect: "was removed" },
    ]);
    await expect(window.controls.status).toHaveText(/^Saved /);
    expect(await window.controls.offered()).toEqual([]);
  });

  test("offers the controls the engine says apply, and waits while the recorder wraps up", async ({
    recording: { browser, window },
  }) => {
    await window.controls.press("Record");
    browser.holdConfirmations();

    await window.controls.press("Stop");
    await expect(window.controls.status).toHaveText(
      "Wrapping up, then pausing"
    );
    expect(await window.controls.offered()).toEqual([]);

    browser.releaseConfirmations();
    await expect(window.controls.status).toHaveText("Paused");
    expect(await window.controls.offered()).toEqual([
      "Continue",
      "Clear",
      "Finish",
    ]);

    await window.controls.press("Continue");
    await expect(window.controls.status).toHaveText("Recording");
    browser.holdConfirmations();
    await window.controls.press("Clear");
    await expect(window.controls.status).toHaveText(
      "Wrapping up, then clearing"
    );
    browser.releaseConfirmations();
    await expect(window.controls.status).toHaveText("Not recording");
    await expect(window.timeline.visits).toHaveCount(0);
    expect(await window.controls.offered()).toEqual(["Record"]);
  });

  test("recovers the current recording when it is reloaded, and can still finish it", async ({
    recording: { browser, window, finished },
  }) => {
    browser.showPage(idle);
    await record(window);
    await clickAddItem(browser, added);
    await expect(window.timeline.visit(0).entries).toHaveCount(1);

    await window.reload();

    await expect(window.controls.status).toHaveText("Recording");
    await expect(window.timeline.visit(0).entry(0).title).toHaveText("Click");
    await window.controls.press("Finish");
    await expect(finished()).resolves.toMatchObject({ kind: "saved" });
    await expect(window.controls.status).toHaveText(/^Saved /);
  });
});
