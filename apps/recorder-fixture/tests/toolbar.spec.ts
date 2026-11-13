import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { startScriptedRecorder } from "@ayme-dev/recorder/testing";
import {
  RecorderToolbar,
  RecorderWindow,
} from "@ayme-dev/recorder-window/testing";
import { selectors } from "@playwright/test";

import { expect, test, toolbarScript, type Recording } from "./fixtures";

// The toolbar in every recorded page. A person presses its buttons and the
// window's over the test's own connection to the browser; what the toolbar
// shows is read through its page object.

/** The recorder's Interactions as a subscriber is told them. */
function interactions({ recorder }: Recording) {
  const seen = { count: 0 };
  recorder.subscribe(({ state }) => {
    seen.count = state.visits
      .flatMap((visit) => visit.entries)
      .filter((entry) => entry.kind === "interaction").length;
  });
  return seen;
}

test.describe("the in-page toolbar", () => {
  test("shows the recorder's state from the start, where Playwright's overlay stays hidden, and is no part of the page's structure", async ({
    startRecording,
  }) => {
    const recording = await startRecording("/cart.html");
    const { page, person, recorder } = recording;
    const toolbar = await RecorderToolbar.on(page, selectors);

    await expect(toolbar.status).toHaveText("Not recording");
    expect(await toolbar.offered()).toEqual(["Record"]);

    await person.click(toolbar.button("Record"));
    await expect(toolbar.status).toHaveText("Recording");
    // Playwright's recorder is on now: what it draws stays hidden.
    await expect(page.locator("x-pw-glass")).toBeHidden();
    const structure = await page.ariaSnapshot({ mode: "ai" });
    expect(structure).not.toMatch(/Recording|Record|Finish|toolbar/);

    await person.click(page.locator("#add"));
    await expect(page.getByText("Items: 1")).toBeVisible();
    await person.pause();
    await person.click(toolbar.button("Finish"));

    const outcome = await recorder.done;
    if (outcome.kind !== "saved") throw new Error("Nothing was saved.");
    const text = await readFile(join(outcome.folder, "package.yaml"), "utf8");
    // The click on the toolbar is no Interaction, and the toolbar is in no
    // snapshot.
    expect(text.match(/kind: interaction/g)).toHaveLength(1);
    expect(text).not.toMatch(/Finish|Record/);
  });

  test("starting in the toolbar reaches the window, and stopping in the window reaches the toolbar", async ({
    startRecording,
    page: windowPage,
  }) => {
    const recording = await startRecording("/cart.html", { window: true });
    const { page, person } = recording;
    const toolbar = await RecorderToolbar.on(page, selectors);
    const window = new RecorderWindow(windowPage);
    await window.open(recording.windowUrl!);

    await person.click(toolbar.button("Record"));
    await expect(window.controls.status).toHaveText("Recording");

    await window.controls.press("Stop");
    await expect(toolbar.status).toHaveText("Paused");
    expect(await toolbar.offered()).toEqual(["Continue", "Clear", "Finish"]);
  });

  test("starting in the window, stopping in the toolbar and resuming keep the timeline", async ({
    startRecording,
    page: windowPage,
  }) => {
    const recording = await startRecording("/cart.html", { window: true });
    const { page, person, recorder } = recording;
    const seen = interactions(recording);
    const toolbar = await RecorderToolbar.on(page, selectors);
    const window = new RecorderWindow(windowPage);
    await window.open(recording.windowUrl!);

    await window.controls.press("Record");
    await expect(toolbar.status).toHaveText("Recording");
    await person.click(page.locator("#add"));
    await expect.poll(() => seen.count).toBe(1);

    await person.click(toolbar.button("Stop"));
    await expect(window.controls.status).toHaveText("Paused");
    await person.click(toolbar.button("Continue"));
    await expect(window.controls.status).toHaveText("Recording");
    await person.click(page.locator("#add"));
    await expect.poll(() => seen.count).toBe(2);

    await expect(window.timeline.visits).toHaveCount(1);
    await expect(window.timeline.visit(0).entries).toHaveCount(2);
    expect(await recorder.send({ type: "finish" })).toBe("applied");
    await expect(recorder.done).resolves.toMatchObject({ kind: "saved" });
  });

  test("is there again after a navigation, showing the current state", async ({
    startRecording,
  }) => {
    const { page, person } = await startRecording("/shop.html");
    const toolbar = await RecorderToolbar.on(page, selectors);
    await person.click(toolbar.button("Record"));
    await expect(toolbar.status).toHaveText("Recording");

    await person.click(page.locator("#checkout"));
    await page.waitForURL(/checkout\.html$/);

    await expect(toolbar.status).toHaveText("Recording");
    expect(await toolbar.offered()).toEqual(["Stop", "Clear", "Finish"]);
  });
});

test.describe("the in-page toolbar in a running browser", () => {
  test.use({ recordedBrowser: "attach" });

  test("shows in the page that was open before the recorder came, and is taken out when the recorder lets go", async ({
    startRecording,
  }) => {
    const { page, person, recorder } = await startRecording("/cart.html");
    const toolbar = await RecorderToolbar.on(page, selectors);
    await expect(toolbar.status).toHaveText("Not recording");
    await person.click(toolbar.button("Record"));
    await expect(toolbar.status).toHaveText("Recording");

    recorder.end();
    await recorder.done;

    await expect(page.locator("ayme-recorder-toolbar")).toHaveCount(0);
    // Nothing puts it back, and the page goes on as before.
    await person.pause();
    await expect(page.locator("ayme-recorder-toolbar")).toHaveCount(0);
    await person.click(page.locator("#add"));
    await expect(page.getByText("Items: 1")).toBeVisible();
  });
});

test.describe("the in-page toolbar on a scripted recorder", () => {
  // The engine's scripted browser keeps the recorder wrapping up for as long
  // as the test likes. The toolbar is put in the test's own page the way the
  // engine puts it in a recorded one: its script before the page's own, and
  // the engine's page function beside it.
  test("shows the wrapping-up state for as long as it lasts", async ({
    page,
    fixturePages,
  }) => {
    const {
      recorder,
      browser,
      toolbar: pageFunction,
    } = await startScriptedRecorder();
    await page.exposeFunction("__aymeRecorderToolbar", pageFunction);
    await page.addInitScript({ path: toolbarScript });
    await page.goto(fixturePages.url("/cart.html"));
    const toolbar = await RecorderToolbar.on(page, selectors);
    await expect(recorder.send({ type: "record" })).resolves.toBe("applied");
    browser.holdConfirmations();

    // Trusted input, from the test's own connection, as a person's is.
    const stop = (await toolbar.button("Stop").boundingBox())!;
    await page.mouse.click(stop.x + stop.width / 2, stop.y + stop.height / 2);

    await expect(toolbar.status).toHaveText("Wrapping up, then pausing");
    expect(await toolbar.offered()).toEqual([]);
    await page.waitForTimeout(500);
    await expect(toolbar.status).toHaveText("Wrapping up, then pausing");
    browser.releaseConfirmations();
    await expect(toolbar.status).toHaveText("Paused");
    recorder.end();
    await recorder.done;
  });
});
