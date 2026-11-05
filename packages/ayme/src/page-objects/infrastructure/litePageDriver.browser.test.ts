import { afterEach, beforeEach, expect, it } from "vitest";
import { createPage } from "@ayme-dev/playwright-lite";

import { litePageDriver } from "./litePageDriver";

// Playwright's highlight adds an overlay host under <html>. That is no change
// of the page: the registry must not probe again for it.

const page = createPage();
const button = page.getByRole("button", { name: "Save" });
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

it("a highlight's overlay does not make the registry's page driver probe", async () => {
  let changes = 0;
  const watch = litePageDriver.watch(() => (changes += 1));
  stop = () => watch.stop();

  await button.highlight({ style: { outline: "2px dashed #d9a441" } });
  await quiet();
  await page.hideHighlight();
  await quiet();

  expect(changes).toBe(0);
});
