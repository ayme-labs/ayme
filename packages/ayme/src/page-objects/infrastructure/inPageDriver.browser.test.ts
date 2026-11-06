import { afterEach, beforeEach, expect, it } from "vitest";
import { createPage } from "@ayme-dev/playwright-lite";

import { inPage } from "../../in-page";
import { inPageDriver } from "./inPageDriver";

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
  let runs = 0;
  const driver = inPageDriver(
    () => inPage(page),
    () => undefined
  );
  stop = driver.watch(async () => {
    runs += 1;
  });
  await driver.probed();
  const started = runs;

  await button.highlight({ style: { outline: "2px dashed #d9a441" } });
  await quiet();
  await page.hideHighlight();
  await quiet();

  expect(runs).toBe(started);
});
