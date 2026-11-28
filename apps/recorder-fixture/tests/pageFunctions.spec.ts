import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { CartPage } from "#pom/CartPage";
import { expect, test } from "./fixtures";

test("a page that hands the recorder's target watch a note of nothing on each click is recorded all the same: each click is a step of the package", async ({
  startRecording,
}) => {
  const { recorder, page, person } = await startRecording("/cart.html");
  const cart = new CartPage(page);
  let steps = 0;
  recorder.subscribe(({ state }) => {
    steps = state.visits
      .flatMap((visit) => visit.entries)
      .filter((entry) => entry.kind === "interaction").length;
  });
  expect(await recorder.send({ type: "record" })).toBe("applied");
  await cart.callRecorderOnClick("Target", null);

  // Two clicks, so a note of nothing is among the recorder's notes when a
  // report comes, whichever comes first: Playwright 1.62 reports a click
  // before the page's note of it, and later versions hold the report back
  // for half a second while the page's call is answered.
  await person.click(cart.addItemButton);
  await expect.poll(() => cart.recorderAnswered()).toBe(1);
  await expect.poll(() => steps).toBe(1);
  await person.click(cart.addItemButton);
  await expect.poll(() => cart.recorderAnswered()).toBe(2);
  await expect.poll(() => steps).toBe(2);
  await expect(cart.itemCount).toHaveText("Items: 2");

  expect(await recorder.send({ type: "finish" })).toBe("applied");
  const outcome = await recorder.done;
  if (outcome.kind !== "saved") throw new Error("Nothing was saved.");
  const text = await readFile(join(outcome.folder, "package.yaml"), "utf8");
  const addItemClicks = text.match(
    /type: click\n.*\n {10}targetSelector: internal:role=button\[name="Add item"i\]\n/g
  );
  expect(addItemClicks ?? []).toHaveLength(2);
});
