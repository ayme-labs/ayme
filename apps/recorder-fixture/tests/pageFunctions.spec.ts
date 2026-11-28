import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { CartPage } from "#pom/CartPage";
import { expect, test } from "./fixtures";

// The recorder's page functions are the page's to call too: what a script
// of the page hands them is never the recorder's to trust.

test("a page that calls the recorder's own page functions with values of another shape on each click is recorded all the same: the click is a step of the package", async ({
  startRecording,
}) => {
  const { recorder, page, person } = await startRecording("/cart.html");
  const cart = new CartPage(page);
  expect(await recorder.send({ type: "record" })).toBe("applied");

  await cart.callRecorderFunctionsOnClick([
    null,
    {},
    "x",
    [1, 2],
    { chain: null },
    { kind: "click" },
    { kind: "key" },
  ]);
  await person.click(cart.addItemButton);
  await expect(cart.itemCount).toHaveText("Items: 1");
  await person.pause();

  expect(await recorder.send({ type: "finish" })).toBe("applied");
  const outcome = await recorder.done;
  if (outcome.kind !== "saved") throw new Error("Nothing was saved.");
  const text = await readFile(join(outcome.folder, "package.yaml"), "utf8");
  expect(text).toContain(
    [
      "          type: click",
      "          targetRef: e5",
      '          targetSelector: internal:role=button[name="Add item"i]',
    ].join("\n")
  );
});
