import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  Entry,
  RecorderToolbar,
  RecorderWindow,
} from "@ayme-dev/recorder-window/testing";
import { selectors, type Locator, type Page } from "@playwright/test";

import { CartPage } from "../.ayme/pom/CartPage";
import { InputsPage } from "../.ayme/pom/InputsPage";
import { expect, test } from "./fixtures";

// Ticket #1278: Assert visibility and the hover highlight, in pages a real
// recorder records, through the toolbar's and the window's page objects,
// with a person's input.

/** Where the recorder's highlight is drawn on the recorded page; null when
 * it draws none. Read in one step, which never waits: the highlight can be
 * cleared at any moment, and a locator's box would wait for it to come back. */
const highlightOn = (page: Page) =>
  page.evaluate(`(() => {
    const host = document.querySelector("ayme-recorder-highlight");
    if (!host) return null;
    const { x, y, width, height } = host.getBoundingClientRect();
    return { x, y, width, height };
  })()`);

/** The box of an element in the page's coordinates. */
async function boxOf(element: Locator) {
  const { x, y, width, height } = (await element.boundingBox())!;
  return {
    x: expect.closeTo(x, 0),
    y: expect.closeTo(y, 0),
    width: expect.closeTo(width, 0),
    height: expect.closeTo(height, 0),
  };
}

test.describe("Assert visibility", () => {
  test("the toolbar and the window each switch it, and each shows the other's change", async ({
    startRecording,
    page: windowPage,
  }) => {
    const recording = await startRecording("/cart.html", { window: true });
    const { page, person } = recording;
    const toolbar = await RecorderToolbar.on(page, selectors);
    const window = new RecorderWindow(windowPage);
    await window.open(recording.windowUrl!);
    await window.controls.recordButton.click();
    await expect(toolbar.stopButton).toBeEnabled();
    expect(await window.controls.picking()).toBe(false);

    await person.click(toolbar.assertVisibility);
    await expect.poll(() => window.controls.picking()).toBe(true);
    expect(await toolbar.picking()).toBe(true);

    await window.controls.assertVisibility.click();
    await expect.poll(() => toolbar.picking()).toBe(false);
    expect(await window.controls.picking()).toBe(false);

    await window.controls.assertVisibility.click();
    await expect.poll(() => toolbar.picking()).toBe(true);
  });

  test("records the element a person picks as an assertion that changed nothing, and the click never reaches the page", async ({
    startRecording,
  }) => {
    const { page, person, recorder } = await startRecording("/cart.html");
    const cart = new CartPage(page);
    const toolbar = await RecorderToolbar.on(page, selectors);
    await person.click(toolbar.recordButton);
    await expect(toolbar.stopButton).toBeEnabled();
    await person.click(cart.addItemButton);
    await expect(cart.itemCount).toHaveText("Items: 1");
    await person.pause();

    await person.click(toolbar.assertVisibility);
    await expect.poll(() => toolbar.picking()).toBe(true);
    // A click on "Add item" would add an item: picking it adds none.
    await person.click(cart.addItemButton);
    await expect.poll(() => toolbar.picking()).toBe(false);
    await person.pause();
    await expect(cart.itemCount).toHaveText("Items: 1");
    expect(await recorder.send({ type: "finish" })).toBe("applied");

    const outcome = await recorder.done;
    if (outcome.kind !== "saved") throw new Error("Nothing was saved.");
    const text = await readFile(join(outcome.folder, "package.yaml"), "utf8");
    expect(text.match(/kind: interaction/g)).toHaveLength(2);
    const assertion = text.slice(text.indexOf("type: assertVisible"));
    expect(assertion).toMatch(
      /^type: assertVisible\n\s+targetRef: \S+\n\s+targetSelector: internal:role=button\[name="Add item"i\]\n/
    );
    // No Change Tree of its own: the next line leaves the entry.
    expect(assertion.split("\n")[3]).not.toMatch(/changeTree/);
  });
});

test.describe("the hover highlight", () => {
  test("highlights an entry's element on the page while its target is hovered in the window, in the page, a frame and a shadow root, and then clears", async ({
    startRecording,
    page: windowPage,
  }) => {
    const recording = await startRecording("/inputs.html", { window: true });
    const { page, person } = recording;
    const inputs = new InputsPage(page);
    const window = new RecorderWindow(windowPage);
    await window.open(recording.windowUrl!);
    await window.controls.recordButton.click();
    await expect(window.controls.stopButton).toBeEnabled();
    const elements = [
      inputs.openTwiceButton,
      inputs.innerButton,
      inputs.shadowButton,
    ];
    for (const element of elements) {
      await person.click(element);
      await person.pause();
    }
    // The clicks, without the changes between them.
    await expect(window.timeline.visitSections).toHaveCount(1);
    const [visit] = await window.timeline.visits();
    const clicks = visit!.entryCards.filter({
      has: windowPage.getByTestId("entry-target"),
    });
    await expect(clicks).toHaveCount(3);
    await window.controls.stopButton.click();
    await expect(window.controls.continueButton).toBeEnabled();

    for (const [index, element] of elements.entries()) {
      const entry = new Entry(clicks.nth(index));
      await entry.target.hover();
      await expect.poll(() => highlightOn(page)).toEqual(await boxOf(element));
      await entry.title.hover();
      await expect.poll(() => highlightOn(page)).toBeNull();
    }
  });

  test("highlights the element of a row of what changed while it is hovered, and then clears", async ({
    startRecording,
    page: windowPage,
  }) => {
    const recording = await startRecording("/cart.html", { window: true });
    const { page, person } = recording;
    const cart = new CartPage(page);
    const window = new RecorderWindow(windowPage);
    await window.open(recording.windowUrl!);
    await window.controls.recordButton.click();
    await expect(window.controls.stopButton).toBeEnabled();
    await person.click(cart.addItemButton);
    await expect(cart.itemCount).toHaveText("Items: 1");
    await expect(window.timeline.visitSections).toHaveCount(1);
    const [visit] = await window.timeline.visits();
    await expect(visit!.entryCards).toHaveCount(1);
    const [click] = await visit!.entries();
    await expect
      .poll(() => click!.whatChanged())
      .toEqual([
        {
          element: "paragraph",
          effect: "text changed from “Items: 0” to “Items: 1”",
        },
      ]);
    const [row] = await click!.changes();

    await row!.element.hover();
    await expect
      .poll(() => highlightOn(page))
      .toEqual(await boxOf(cart.itemCount));
    await click!.title.hover();
    await expect.poll(() => highlightOn(page)).toBeNull();
  });
});
