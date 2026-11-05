import { afterEach, beforeEach, expect, it } from "vitest";
import { createPage } from "@ayme-dev/playwright-lite";

import { getBrowserPageActivitySource } from "./pageActivitySource";

// Playwright's highlight adds an overlay host under <html> and moves boxes in
// it. That is no activity of the page: a settle wait must not be extended by it.

const page = createPage();
const button = page.getByRole("button", { name: "Save" });
const style = { outline: "2px dashed #d9a441" };
let stop: (() => void) | undefined;

beforeEach(() => {
  document.body.insertAdjacentHTML(
    "beforeend",
    '<main id="host"><button>Save</button></main>'
  );
});

afterEach(async () => {
  stop?.();
  stop = undefined;
  await page.hideHighlight();
  document.querySelector("#host")?.remove();
});

const quiet = () => new Promise((resolve) => setTimeout(resolve, 300));

it("a highlight's overlay is no page activity", async () => {
  let activity = 0;
  stop = getBrowserPageActivitySource(document).subscribe(
    () => (activity += 1)
  );

  await button.highlight({ style });
  await quiet();
  await page.hideHighlight();
  await quiet();

  expect(activity).toBe(0);
});

it("a change of the app still is", async () => {
  let activity = 0;
  stop = getBrowserPageActivitySource(document).subscribe(
    () => (activity += 1)
  );

  await button.highlight({ style });
  document.querySelector("#host")!.append(document.createElement("p"));
  await quiet();

  expect(activity).toBeGreaterThan(0);
});
