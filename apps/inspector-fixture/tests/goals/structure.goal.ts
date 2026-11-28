import { describe } from "@e2e-dev/web";
import { expect } from "e2e";

import {
  outline,
  placements,
  testIn,
  confirmGoalRecordings,
  movePointerTo,
} from "../e2e/fixtures";

// The goal-driven twin of ../structure.e2e.ts: the same tests, with each
// action on the panel an agent goal.
//
// E2E: the Structure lens on the fixture page, with the real runtime, in
// both placements of the Inspector.

for (const placement of placements) {
  const test = testIn(placement);

  describe(placement, () => {
    test("selecting a structure node highlights it solid on the page", async ({
      agent,
      browser,
      inspector,
      listPage,
    }) => {
      await agent.act("show the {lens} lens", {
        params: { lens: "Structure" },
      });

      await agent.act("select the node tagged {tag} in the Structure lens", {
        params: { tag: ".newItemInput" },
      });
      await movePointerTo(inspector.navigator.searchBox);
      await expect.poll(outline(listPage.newItemInput, browser)).toBe("solid");

      await confirmGoalRecordings(browser);
    });

    test("a text field's node offers fill, and a button's does not", async ({
      browser,
      agent,
      inspector,
    }) => {
      await agent.act("show the {lens} lens", {
        params: { lens: "Structure" },
      });

      await agent.act("select the node tagged {tag} in the Structure lens", {
        params: { tag: ".newItemInput" },
      });
      await expect(
        await inspector.detail.node.tool("fill").front()
      ).toHaveCount(1);

      await agent.act("select the node tagged {tag} in the Structure lens", {
        params: { tag: ".addItemButton" },
      });
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

// The hover runs inline only, for the reason ../modelLens.e2e.ts gives.
const inlineTest = testIn("inline");

describe("inline", () => {
  inlineTest(
    "hovering a structure node highlights it dashed on the page",
    async ({ agent, browser, listPage }) => {
      await agent.act("show the {lens} lens", {
        params: { lens: "Structure" },
      });

      await agent.act("hover the node tagged {tag} in the Structure lens", {
        params: { tag: ".newItemInput" },
      });
      await expect.poll(outline(listPage.newItemInput, browser)).toBe("dashed");

      await confirmGoalRecordings(browser);
    }
  );
});
