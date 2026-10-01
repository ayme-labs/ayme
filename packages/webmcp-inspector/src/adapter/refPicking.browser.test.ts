import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createPage } from "@ayme-dev/playwright-lite";

import { startRefPicking } from "./refPicking";

// Browser tests: picking a ref on a host page in Chromium, driven by
// playwright-lite's pointer. The adapter's look at the page is replaced: an
// element's ref is its data-ref attribute, and the hover highlight is
// recorded. So the evidence covers picking itself, not the page state or
// the highlight's drawing (the e2e suite covers those).

const page = createPage();
const host = page.locator("#host");
const addItem = host.getByRole("button", { name: "Add item" });
const newItem = host.getByRole("textbox", { name: "New item" });
const stops: (() => void)[] = [];
let hovered: string | undefined;

/** Starts picking on the fixture page. */
function pick(accept: (ref: string) => boolean, onEnd = vi.fn()) {
  stops.push(
    startRefPicking({
      accept,
      onEnd,
      refOf: (element) => element.getAttribute("data-ref") ?? undefined,
      hover: (ref) => (hovered = ref),
    })
  );
  return onEnd;
}

beforeEach(() => {
  document.body.insertAdjacentHTML(
    "beforeend",
    `<main id="host">
      <input data-ref="e2" aria-label="New item">
      <button data-ref="e3"><span>Add item</span></button>
    </main>`
  );
});

afterEach(() => {
  for (const stop of stops.splice(0)) stop();
  hovered = undefined;
  document.querySelector("#host")?.remove();
});

/** Picking with a tool that can use the text field only. */
function pickTextFields() {
  return pick((ref) => ref === "e2");
}

const marks = async (locator: typeof addItem) => ({
  highlighted:
    hovered !== undefined &&
    (await locator.getAttribute("data-ref")) === hovered,
  greyed: (await locator.getAttribute("data-ayme-pick-unusable")) !== null,
});

const cursor = (locator: typeof addItem) =>
  locator.evaluate((element) => getComputedStyle(element).cursor);

it("highlights the element the tool can use, and greys the one it can't", async () => {
  pickTextFields();

  // The pointer lands on the button's text; its button carries the ref.
  await expect
    .poll(async () => (await addItem.locator("span").hover(), marks(addItem)))
    .toEqual({ highlighted: false, greyed: true });
  await newItem.hover();

  expect(await marks(newItem)).toEqual({ highlighted: true, greyed: false });
  expect(await marks(addItem)).toEqual({ highlighted: false, greyed: false });
});

it("picks the element clicked, when the tool can use it", async () => {
  const onEnd = pickTextFields();

  await addItem.click();
  await newItem.click();

  await expect.poll(() => onEnd.mock.calls).toEqual([["e2"]]);
  // The page never saw the presses.
  expect(document.activeElement).not.toBe(await newItem.elementHandle());
});

it("keeps every press from the page: double, right and middle clicks too", async () => {
  const seen: string[] = [];
  const types = ["click", "dblclick", "auxclick", "contextmenu"];
  const record = (event: Event) => seen.push(event.type);
  const main = document.querySelector("#host")!;
  for (const type of types) main.addEventListener(type, record);
  pickTextFields();

  await addItem.dblclick();
  await addItem.click({ button: "right" });
  await addItem.click({ button: "middle" });

  expect(seen).toEqual([]);
  for (const type of types) main.removeEventListener(type, record);
});

it("cancels on Esc, leaving the page as it was", async () => {
  const onEnd = pickTextFields();
  await expect
    .poll(async () => (await newItem.hover(), marks(newItem)))
    .toEqual({ highlighted: true, greyed: false });

  await page.keyboard.press("Escape");

  expect(onEnd).toHaveBeenCalledExactlyOnceWith(undefined);
  expect(await marks(newItem)).toEqual({ highlighted: false, greyed: false });
  expect(await cursor(addItem)).not.toBe("crosshair");
});

it("shows a crosshair over the page until the last picking stops", async () => {
  const before = await cursor(addItem);
  pick(() => true);
  pick(() => true);
  const [stopFirst, stopSecond] = stops as [() => void, () => void];

  expect(await cursor(addItem)).toBe("crosshair");
  stopFirst();
  stopFirst();
  expect(await cursor(addItem)).toBe("crosshair");
  stopSecond();
  expect(await cursor(addItem)).toBe(before);
});
