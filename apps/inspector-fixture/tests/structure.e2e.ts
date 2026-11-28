import { describe } from "@e2e-dev/web";
import { expect } from "e2e";

import {
  outline,
  placements,
  testIn,
  confirmGoalRecordings,
  movePointerTo,
} from "./e2e/fixtures";

// E2E: the Structure lens on the fixture page, with the real runtime, in
// both placements of the Inspector.

for (const placement of placements) {
  const test = testIn(placement);

  describe(placement, () => {
    test("hovering a structure node highlights it on the page, and selecting it keeps it highlighted", async ({
      browser,
      inspector,
      listPage,
    }) => {
      await inspector.navigator.showLens("Structure");

      await inspector.structure.nodeOf("ListPage.newItemInput").hover();
      await expect.poll(outline(listPage.newItemInput, browser)).toBe("dashed");

      await inspector.structure.nodeOf("ListPage.newItemInput").click();
      await movePointerTo(inspector.navigator.searchBox);
      await expect.poll(outline(listPage.newItemInput, browser)).toBe("solid");

      await confirmGoalRecordings(browser);
    });

    test("a text field's node offers fill, and a button's does not", async ({
      browser,
      inspector,
    }) => {
      await inspector.navigator.showLens("Structure");

      await inspector.structure.nodeOf("ListPage.newItemInput").click();
      await expect(
        await inspector.detail.node.tool("fill").front()
      ).toHaveCount(1);

      await inspector.structure.nodeOf("ListPage.addItemButton").click();
      await expect(
        await inspector.detail.node.tool("click").front()
      ).toHaveCount(1);
      await expect(
        await inspector.detail.node.tool("fill").front()
      ).toHaveCount(0);

      await confirmGoalRecordings(browser);
    });
  });
}
