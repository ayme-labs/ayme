import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { CartPage } from "#pom/CartPage";
import { expect, test, type Recording } from "./fixtures";
import { stockTraceTool } from "./stockTrace";

/** Presses Finish and reads the package the recorder says it saved. */
async function finish({ recorder }: Recording) {
  expect(await recorder.send({ type: "finish" })).toBe("applied");
  const outcome = await recorder.done;
  if (outcome.kind !== "saved") throw new Error("Nothing was saved.");
  return {
    folder: outcome.folder,
    text: await readFile(join(outcome.folder, "package.yaml"), "utf8"),
  };
}

/** The positions a package gives for each Interaction. */
function positionsIn(text: string) {
  return [
    ...text.matchAll(
      /- interactionId: (\w+)\n\s+pageId: \w+\n\s+beforeSnapshotId: "(\d+)"\n\s+afterSnapshotId: "(\d+)"/g
    ),
  ].map(([, id, before, after]) => ({
    id: id!,
    before: before!,
    after: after!,
  }));
}

test.describe("the trace of a recording", () => {
  test("opens an Interaction's before and after with the stock trace tool, by the package's own position numbers", async ({
    startRecording,
  }) => {
    // Opening a snapshot is honest work: the stock tool launches a browser to
    // render it, about 6 s each on a developer's machine and more on CI's, and
    // the default 30 s left no room for two of them next to the recording.
    test.setTimeout(90_000);
    const recording = await startRecording("/cart.html");
    const { recorder, page, person } = recording;
    const cart = new CartPage(page);
    await recorder.send({ type: "record" });
    await person.click(cart.addItemButton);
    await expect(cart.itemCount).toHaveText("Items: 1");
    await person.pause();
    await person.click(cart.addItemButton);
    await expect(cart.itemCount).toHaveText("Items: 2");

    const { folder, text } = await finish(recording);

    const points = positionsIn(text);
    expect(points.map(({ id }) => id)).toEqual([
      "interaction_1",
      "interaction_2",
    ]);
    // The trace is beside the package, where the package says it is.
    expect(text).toMatch(/^tracePath: ayme\/recordings\/rec_\w+\/trace\.zip$/m);
    const stock = await stockTraceTool();
    try {
      await stock.open(join(folder, "trace.zip"));
      // The expected element is the page's count: what the second click
      // started from, and what it ended at. The second, not the first, so that
      // numbers that only fit the first Interaction would be found out: the
      // first click's "after" shows the same count as this "before", at
      // another position.
      const count = "document.getElementById('count').textContent";
      const second = points[1]!;
      expect(second.before).not.toBe(points[0]!.after);
      expect(await stock.evaluateAt(second.before, count)).toBe("Items: 1");
      expect(await stock.evaluateAt(second.after, count)).toBe("Items: 2");
    } finally {
      await stock.close();
    }
  });
});
