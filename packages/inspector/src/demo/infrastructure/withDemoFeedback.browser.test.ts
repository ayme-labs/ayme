import { afterEach, expect, it } from "vitest";
import { createPage } from "@ayme-dev/playwright-lite";
import type { Locator, Page } from "@playwright/test";

import { withDemoFeedback } from "./withDemoFeedback";

// The click cue on a real page: each action that clicks its element shows
// one, whether it runs on a locator or on the Page by selector.

afterEach(() => {
  document.body.innerHTML = "";
});

/** Runs `act` on a demo Page; returns how many click cues it showed. */
async function cuesOf(act: (page: Page) => Promise<unknown>) {
  document.body.innerHTML = `
    <button>Go</button>
    <label><input type="checkbox" /> Done</label>
    <input aria-label="Name" />
  `;
  let cues = 0;
  const observer = new MutationObserver((records) => {
    for (const record of records)
      for (const node of record.addedNodes)
        if (node instanceof HTMLElement && "demoClickCue" in node.dataset)
          cues += 1;
  });
  observer.observe(document.body, { childList: true });
  const page = withDemoFeedback(createPage() as unknown as Page, {
    clickCue: true,
    onTrace() {},
  });
  try {
    await act(page);
  } finally {
    observer.disconnect();
  }
  return cues;
}

const button = (page: Page): Locator => page.getByRole("button");
const checkbox = (page: Page): Locator => page.getByRole("checkbox");

it.each([
  ["click", (page: Page) => button(page).click()],
  ["dblclick", (page: Page) => button(page).dblclick()],
  // This page has no touch support, so the tap itself fails after its cue.
  [
    "tap",
    (page: Page) =>
      button(page)
        .tap()
        .catch(() => {}),
  ],
  ["check", (page: Page) => checkbox(page).check()],
  [
    "uncheck",
    async (page: Page) => {
      await checkbox(page).evaluate((box: HTMLInputElement) => {
        box.checked = true;
      });
      await checkbox(page).uncheck();
    },
  ],
  ["setChecked", (page: Page) => checkbox(page).setChecked(true)],
  ["the Page's click", (page: Page) => page.click("button")],
])("cues %s", async (_, act) => {
  expect(await cuesOf(act)).toBe(1);
});

it.each([
  ["hover", (page: Page) => button(page).hover()],
  ["fill", (page: Page) => page.getByLabel("Name").fill("Ada")],
])("does not cue %s", async (_, act) => {
  expect(await cuesOf(act)).toBe(0);
});
