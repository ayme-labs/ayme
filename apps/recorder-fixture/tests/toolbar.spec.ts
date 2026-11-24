import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { startScriptedRecorder } from "@ayme-dev/recorder/testing";
import {
  RecorderToolbar,
  RecorderWindow,
} from "@ayme-dev/recorder-window/testing";
import { selectors } from "@playwright/test";

import { CartPage } from "../ayme/pom/CartPage";
import { ShopPage } from "../ayme/pom/ShopPage";
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
  test("shows the recorder's state from the start, at the top centre, where Playwright's overlay stays hidden, and is no part of the page's structure", async ({
    startRecording,
  }) => {
    const recording = await startRecording("/cart.html");
    const { page, person, recorder } = recording;
    const cart = new CartPage(page);
    const toolbar = await RecorderToolbar.on(page, selectors);

    await expect(toolbar.recordButton).toBeEnabled();
    expect(await toolbar.offered()).toEqual(["Record"]);
    const box = (await toolbar.root.boundingBox())!;
    const width = (await page.evaluate("innerWidth")) as number;
    expect(box.y).toBe(12);
    expect(Math.abs(box.x + box.width / 2 - width / 2)).toBeLessThanOrEqual(1);

    await person.click(toolbar.recordButton);
    await expect(toolbar.stopButton).toBeEnabled();
    // Playwright's recorder is on now: what it draws stays hidden.
    await expect(page.locator("x-pw-glass")).toBeHidden();
    const structure = await page.ariaSnapshot({ mode: "ai" });
    expect(structure).not.toMatch(/Record|Stop|Assert|toolbar/);

    await person.click(cart.addItemButton);
    await expect(cart.itemCount).toHaveText("Items: 1");
    await person.pause();
    expect(await recorder.send({ type: "finish" })).toBe("applied");

    const outcome = await recorder.done;
    if (outcome.kind !== "saved") throw new Error("Nothing was saved.");
    const text = await readFile(join(outcome.folder, "package.yaml"), "utf8");
    // The click on the toolbar is no Interaction, and the toolbar is in no
    // snapshot.
    expect(text.match(/kind: interaction/g)).toHaveLength(1);
    expect(text).not.toMatch(/Record|Stop|Assert visibility/);
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

    await person.click(toolbar.recordButton);
    await expect(window.controls.stopButton).toBeEnabled();

    await window.controls.stopButton.click();
    await expect(toolbar.continueButton).toBeEnabled();
    expect(await toolbar.offered()).toEqual(["Continue recording"]);
  });

  test("starting in the window, stopping in the toolbar and resuming keep the timeline", async ({
    startRecording,
    page: windowPage,
  }) => {
    const recording = await startRecording("/cart.html", { window: true });
    const { page, person, recorder } = recording;
    const cart = new CartPage(page);
    const seen = interactions(recording);
    const toolbar = await RecorderToolbar.on(page, selectors);
    const window = new RecorderWindow(windowPage);
    await window.open(recording.windowUrl!);

    await window.controls.recordButton.click();
    await expect(toolbar.stopButton).toBeEnabled();
    await person.click(cart.addItemButton);
    await expect.poll(() => seen.count).toBe(1);

    await person.click(toolbar.stopButton);
    await expect(window.controls.continueButton).toBeEnabled();
    await person.click(toolbar.continueButton);
    await expect(window.controls.stopButton).toBeEnabled();
    await person.click(cart.addItemButton);
    await expect.poll(() => seen.count).toBe(2);

    await expect(window.timeline.visitSections).toHaveCount(1);
    const [visit] = await window.timeline.visits();
    await expect(visit!.entryCards).toHaveCount(2);
    expect(await recorder.send({ type: "finish" })).toBe("applied");
    await expect(recorder.done).resolves.toMatchObject({ kind: "saved" });
  });

  test("is there again after a navigation, showing the current state", async ({
    startRecording,
  }) => {
    const { page, person } = await startRecording("/shop.html");
    const shop = new ShopPage(page);
    const toolbar = await RecorderToolbar.on(page, selectors);
    await person.click(toolbar.recordButton);
    await expect(toolbar.stopButton).toBeEnabled();

    await person.click(shop.checkoutLink);
    await page.waitForURL(/checkout\.html$/);

    await expect(toolbar.stopButton).toBeEnabled();
    expect(await toolbar.offered()).toEqual(["Stop"]);
  });
});

test.describe("the in-page toolbar in a running browser", () => {
  test.use({ recordedBrowser: "attach" });

  test("shows in the page that was open before the recorder came, and is taken out when the recorder lets go", async ({
    startRecording,
  }) => {
    const { page, person, recorder } = await startRecording("/cart.html");
    const cart = new CartPage(page);
    const toolbar = await RecorderToolbar.on(page, selectors);
    await expect(toolbar.recordButton).toBeEnabled();
    await person.click(toolbar.recordButton);
    await expect(toolbar.stopButton).toBeEnabled();

    recorder.end();
    await recorder.done;

    await expect(page.locator("ayme-recorder-toolbar")).toHaveCount(0);
    // Nothing puts it back, and the page goes on as before.
    await person.pause();
    await expect(page.locator("ayme-recorder-toolbar")).toHaveCount(0);
    await person.click(cart.addItemButton);
    await expect(cart.itemCount).toHaveText("Items: 1");
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
    const stop = (await toolbar.stopButton.boundingBox())!;
    await page.mouse.click(stop.x + stop.width / 2, stop.y + stop.height / 2);

    await expect.poll(() => toolbar.busy()).toBe("Wrapping up, then pausing");
    expect(await toolbar.offered()).toEqual([]);
    await page.waitForTimeout(500);
    expect(await toolbar.busy()).toBe("Wrapping up, then pausing");
    browser.releaseConfirmations();
    await expect(toolbar.continueButton).toBeEnabled();
    expect(await toolbar.busy()).toBeNull();
    recorder.end();
    await recorder.done;
  });
});
