import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  Entry,
  RecorderToolbar,
  RecorderWindow,
} from "@ayme-dev/recorder-window/testing";
import { selectors, type Locator, type Page } from "@playwright/test";

import { expect, test } from "./fixtures";

// Ticket #1278: Assert visibility and the hover highlight, in pages a real
// recorder records, through the toolbar's and the window's page objects,
// with a person's input.

/** Where the recorder's highlight is drawn on the recorded page; null when
 * it draws none. */
async function highlightOn(page: Page) {
  const host = page.locator("ayme-recorder-highlight");
  if ((await host.count()) === 0) return null;
  return host.boundingBox();
}

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
    await window.controls.press("Record");
    await expect(toolbar.status).toHaveText("Recording");
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
    const toolbar = await RecorderToolbar.on(page, selectors);
    await person.click(toolbar.button("Record"));
    await expect(toolbar.status).toHaveText("Recording");
    await person.click(page.locator("#add"));
    await expect(page.getByText("Items: 1")).toBeVisible();
    await person.pause();

    await person.click(toolbar.assertVisibility);
    await expect.poll(() => toolbar.picking()).toBe(true);
    // A click on "Add item" would add an item: picking it adds none.
    await person.click(page.locator("#add"));
    await expect.poll(() => toolbar.picking()).toBe(false);
    await person.pause();
    await expect(page.getByText("Items: 1")).toBeVisible();
    await person.click(toolbar.button("Finish"));

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
    const window = new RecorderWindow(windowPage);
    await window.open(recording.windowUrl!);
    await window.controls.press("Record");
    await expect(window.controls.status).toHaveText("Recording");
    const elements = [
      page.locator("#twice"),
      page.frameLocator("#frame").locator("#inner"),
      page.locator("#shadowed"),
    ];
    for (const element of elements) {
      await person.click(element);
      await person.pause();
    }
    // The clicks, without the changes between them.
    const clicks = window.timeline
      .visit(0)
      .entries.filter({ has: windowPage.getByTestId("entry-target") });
    await expect(clicks).toHaveCount(3);
    await window.controls.press("Stop");
    await expect(window.controls.status).toHaveText("Paused");

    for (const [index, element] of elements.entries()) {
      const entry = new Entry(clicks.nth(index));
      await entry.hoverTarget();
      await expect.poll(() => highlightOn(page)).toEqual(await boxOf(element));
      await entry.leaveTarget();
      await expect.poll(() => highlightOn(page)).toBeNull();
    }
  });
});
