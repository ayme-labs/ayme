import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { RecorderToolbar } from "@ayme-dev/recorder-window/testing";
import { selectors, type Locator } from "@playwright/test";

import { OutsideClickPage } from "../ayme/pom/OutsideClickPage";
import { expect, test } from "./fixtures";

// Issue #1396: a press on the page's toolbar is no press outside a panel the
// page closes on one, so the panel stays open and what is inside it can be
// asserted. The page hears nothing of the press: not its pointerdown or
// mousedown, nor the click the toolbar gives its own button.

const panels: {
  readonly heard: string;
  /** The name of the button inside the panel, as the package names it. */
  readonly inside: string;
  /** The panel closes when the focus leaves it, so it must hold the focus
   * before the press for the case to mean anything. */
  readonly holdsFocus?: true;
  readonly of: (page: OutsideClickPage) => {
    open: Locator;
    panel: Locator;
    inside: Locator;
  };
}[] = [
  {
    heard: "a click on the document",
    inside: "Inside click panel",
    of: (page) => ({
      open: page.openClickPanelButton,
      panel: page.clickPanel,
      inside: page.insideClickPanelButton,
    }),
  },
  {
    heard: "a pointerdown on the document, in the capture phase",
    inside: "Inside pointerdown panel",
    of: (page) => ({
      open: page.openPointerdownPanelButton,
      panel: page.pointerdownPanel,
      inside: page.insidePointerdownPanelButton,
    }),
  },
  {
    heard: "a mousedown on the document, in the capture phase",
    inside: "Inside mousedown panel",
    of: (page) => ({
      open: page.openMousedownPanelButton,
      panel: page.mousedownPanel,
      inside: page.insideMousedownPanelButton,
    }),
  },
  {
    heard: "the focus leaving it",
    inside: "Inside focusout panel",
    holdsFocus: true,
    of: (page) => ({
      open: page.openFocusoutPanelButton,
      panel: page.focusoutPanel,
      inside: page.insideFocusoutPanelButton,
    }),
  },
];

for (const { heard, inside: name, holdsFocus, of } of panels) {
  test(`a panel closed by ${heard} stays open on Assert visibility in the toolbar, and what is inside it can be asserted`, async ({
    startRecording,
  }) => {
    const { page, person, recorder } = await startRecording(
      "/outside-click.html"
    );
    const { open, panel, inside } = of(new OutsideClickPage(page));
    const toolbar = await RecorderToolbar.on(page, selectors);
    await person.click(toolbar.recordButton);
    await expect(toolbar.stopButton).toBeEnabled();
    await person.click(open);
    await expect(panel).toBeVisible();
    await person.pause();
    if (holdsFocus) await expect(panel).toBeFocused();

    await person.click(toolbar.assertVisibility);
    await expect.poll(() => toolbar.picking()).toBe(true);
    await person.pause();
    await expect(panel).toBeVisible();

    await person.click(inside);
    await expect.poll(() => toolbar.picking()).toBe(false);
    await person.pause();
    expect(await recorder.send({ type: "finish" })).toBe("applied");

    const outcome = await recorder.done;
    if (outcome.kind !== "saved") throw new Error("Nothing was saved.");
    const text = await readFile(join(outcome.folder, "package.yaml"), "utf8");
    expect(text).toMatch(
      new RegExp(
        `type: assertVisible\\n\\s+targetRef: e\\d+\\n\\s+targetSelector: internal:role=button\\[name="${name}"i\\]\\n`
      )
    );
  });
}
