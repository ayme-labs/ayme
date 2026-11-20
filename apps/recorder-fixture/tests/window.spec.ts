import { mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname } from "node:path";
import {
  startScriptedRecorder,
  type ScriptedBrowser,
} from "@ayme-dev/recorder/testing";
import { RecorderWindow, type Visit } from "@ayme-dev/recorder-window/testing";

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
/** The page after "Add item": a list of two items appeared. */
const added = [
  `- generic [ref=e1]:`,
  `  - button "Add item" [ref=e2]`,
  `  - list "Cart" [ref=e3]:`,
  `    - listitem [ref=e4]: Milk`,
  `    - listitem [ref=e5]: Bread`,
].join("\n");

/** Presses Record, and waits until the window offers to stop. */
async function record(window: RecorderWindow) {
  await window.controls.recordButton.click();
  await expect(window.controls.stopButton).toBeEnabled();
}

/** The window's first Visit, once it shows one. */
async function firstVisit(window: RecorderWindow) {
  await expect(window.timeline.visitSections).not.toHaveCount(0);
  return (await window.timeline.visits())[0]!;
}

/** The entries of `visit`, once it shows `count` of them. */
async function entriesOf(visit: Visit, count: number) {
  await expect(visit.entryCards).toHaveCount(count);
  return visit.entries();
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
    // As the stock adapter puts on every report: Playwright's own words.
    locator: "getByRole('button', { name: 'Add item' })",
    target: { ref: "e2", tree: idle },
    values: { button: "left", modifiers: 0, clickCount: 1 },
  });
}

test.describe("the recorder window", () => {
  test("opens idle with no Visit; pressing Record starts a Visit for the current page", async ({
    recording: { window },
  }) => {
    await expect(window.controls.status).toHaveText("");
    await expect(window.timeline.visitSections).toHaveCount(0);
    await expect(window.timeline.empty).toBeVisible();
    expect(await window.controls.offered()).toEqual(["Record"]);

    await window.controls.recordButton.click();

    const visit = await firstVisit(window);
    await expect(visit.heading).toHaveText("Page 1");
    await expect(visit.start).toHaveText("Navigated to http://shop.test/");
    expect(await window.controls.offered()).toEqual([
      "Stop",
      "Clear",
      "Finish",
    ]);
    await expect(window.controls.status).toHaveText("");
  });

  test("shows each entry live, its target by role and name and its selector in Playwright's words on hover, with only the roots of what changed", async ({
    recording: { browser, window },
  }) => {
    browser.showPage(idle);
    await record(window);

    await clickAddItem(browser, added);

    const [entry] = await entriesOf(await firstVisit(window), 1);
    await expect(entry!.title).toHaveText("Click");
    await expect(entry!.target).toHaveText("button “Add item”");
    // Its selector on hover, in Playwright's own words.
    await expect(entry!.target).toHaveAttribute(
      "title",
      "getByRole('button', { name: 'Add item' })"
    );
    // The list appeared: its items are inside it, and not rows of their own.
    await expect
      .poll(() => entry!.whatChanged())
      .toEqual([{ element: "list “Cart”", effect: "appeared" }]);
  });

  test("shows a change that belongs to no Interaction with the next Interaction, and the last one at Finish", async ({
    recording: { browser, window, finished },
  }) => {
    browser.showPage(idle);
    await record(window);
    await clickAddItem(browser, added);
    const visit = await firstVisit(window);
    await entriesOf(visit, 1);

    // The page drops Bread on its own: nothing is shown until something
    // else is recorded.
    browser.showPage(added.replace(`\n    - listitem [ref=e5]: Bread`, ""));
    await clickAddItem(browser, added.replace("Milk", "Milk, 2"), "input_2");
    const [, change, click] = await entriesOf(visit, 3);
    await expect(change!.title).toHaveText("Element removed");
    await expect(change!.target).toHaveCount(0);
    expect(await change!.whatChanged()).toEqual([
      { element: "listitem “Bread”", effect: "was removed" },
    ]);
    await expect(click!.title).toHaveText("Click");

    // And again after the last Interaction: it shows at Finish.
    browser.showPage(idle);
    await window.controls.finishButton.click();
    await finished();
    const [, , , last] = await entriesOf(visit, 4);
    expect(await last!.whatChanged()).toEqual([
      { element: "list “Cart”", effect: "was removed" },
    ]);
    await expect(window.controls.status).toHaveText(/^Saved /);
    expect(await window.controls.offered()).toEqual([]);
  });

  test("offers the controls the engine says apply, and waits while the recorder wraps up", async ({
    recording: { browser, window },
  }) => {
    // Stop is offered once Record is answered: until the pages hold inputs
    // back the recorder is not shown recording.
    await record(window);
    browser.holdConfirmations();

    await window.controls.stopButton.click();
    await expect(window.controls.status).toHaveText(
      "Wrapping up, then pausing"
    );
    expect(await window.controls.offered()).toEqual([]);

    browser.releaseConfirmations();
    await expect(window.controls.continueButton).toBeEnabled();
    await expect(window.controls.status).toHaveText("");
    expect(await window.controls.offered()).toEqual([
      "Continue recording",
      "Clear",
      "Finish",
    ]);

    await window.controls.continueButton.click();
    await expect(window.controls.stopButton).toBeEnabled();
    browser.holdConfirmations();
    await window.controls.clearButton.click();
    await expect(window.controls.status).toHaveText(
      "Wrapping up, then clearing"
    );
    browser.releaseConfirmations();
    await expect(window.controls.recordButton).toBeEnabled();
    await expect(window.timeline.visitSections).toHaveCount(0);
    expect(await window.controls.offered()).toEqual(["Record"]);
  });

  test("names the page that is open in its title, before Record, while recording and after Clear", async ({
    recording: { window },
  }) => {
    const title = "Ayme Recorder - http://shop.test/";
    await expect(window.page).toHaveTitle(title);

    await record(window);
    await expect(window.page).toHaveTitle(title);

    await window.controls.clearButton.click();
    await expect(window.controls.recordButton).toBeEnabled();
    await expect(window.page).toHaveTitle(title);
  });

  test("shows the design system's purple mark as its icon, in either scheme", async ({
    recording: { window },
  }) => {
    const icons = window.page.locator('link[rel="icon"]');
    await expect(icons).toHaveCount(1);
    expect(await icons.getAttribute("media")).toBeNull();
    const served = await window.page.request.get(
      new URL((await icons.getAttribute("href"))!, window.page.url()).href
    );
    expect(served.status()).toBe(200);
    expect(served.headers()["content-type"]).toBe("image/svg+xml");
    expect(await served.text()).toContain('fill="#6936f1"');
  });

  test("recovers the current recording when it is reloaded, and can still finish it", async ({
    recording: { browser, window, finished },
  }) => {
    browser.showPage(idle);
    await record(window);
    await clickAddItem(browser, added);
    await entriesOf(await firstVisit(window), 1);

    await window.reload();

    await expect(window.controls.stopButton).toBeEnabled();
    const [entry] = await entriesOf(await firstVisit(window), 1);
    await expect(entry!.title).toHaveText("Click");
    await window.controls.finishButton.click();
    await expect(finished()).resolves.toMatchObject({ kind: "saved" });
    await expect(window.controls.status).toHaveText(/^Saved /);
  });
});
