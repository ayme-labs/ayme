import { describe } from "@e2e-dev/web";
import { expect } from "e2e";

import { INSPECTOR, placements, testIn } from "../e2e/fixtures";

// The goal-driven twin of ../detailRuns.e2e.ts: the same tests, with each
// action on the panel an agent goal.
//
// E2E: the lenses, the run card, Runs and What the model sees working
// together on the fixture page, with the real runtime, in both placements of
// the Inspector. Expected values come from the page and its runtime, never
// from the panel.

for (const placement of placements) {
  const test = testIn(placement);

  describe(placement, () => {
    test("a structure node's Browser tool runs on that node, and Runs shows the run as yours", async ({
      agent,
      inspector,
      listPage,
    }) => {
      await agent.act("show the {lens} lens", {
        params: { lens: "Structure" },
      });
      await agent.act("select the {member} node in the Structure lens", {
        params: { member: "ListPage.newItemInput" },
      });

      await agent.act("run {tool} with the text {text}", {
        params: { tool: "fill", text: "Bread" },
      });

      await expect(await listPage.newItemInput.front()).toHaveValue("Bread");
      const run = inspector.runs.latest("fill");
      await expect.poll(() => run.status()).toBe("Succeeded");
      expect(await run.caller()).toEqual(INSPECTOR);
    });

    test("a tool's page runs it from a card without a head, and What the model sees shows the definition snapshot gives", async ({
      agent,
      appView,
      inspector,
      listPage,
    }) => {
      const addItem = (await appView.tools()).find(
        ({ name }) => name === "ListPage.addItem"
      )!;
      const definition = await appView.pomDefinitions("ListPage");
      const { toolPage } = inspector.detail;

      await agent.act("open the {tool} tool", {
        params: { tool: "ListPage.addItem" },
      });
      const card = inspector.detail.runCard();

      await expect
        .poll(() => toolPage.descriptionText())
        .toBe(addItem.agentDescription ?? "");
      await expect(await card.argumentsToggle.front()).toHaveCount(0);
      await agent.act("run it with the text {text}", {
        params: { text: "Bread" },
      });
      await expect(
        await listPage.items
          .within((items) => items.filter({ hasText: "Bread" }))
          .front()
      ).toHaveCount(1);
      await agent.act("open What the model sees");
      await expect
        .poll(() => toolPage.modelSees.definitionsText())
        .toBe(definition);
    });

    test("a checked checkbox reads as checked in its node's What the model sees, as in the page state snapshot gives", async ({
      agent,
      appView,
      inspector,
      listPage,
    }) => {
      await agent.act("show the {lens} lens", {
        params: { lens: "Structure" },
      });
      await agent.act("select the {role} {name} node in the Structure lens", {
        params: { role: "checkbox", name: "Urgent" },
      });
      const { modelSees } = inspector.detail.node;
      await agent.act("open What the model sees");

      await listPage.urgentCheckbox.check();

      await expect(await modelSees.pageState.front()).toContainText(
        "[checked]"
      );
      const structure = await appView.structure();
      const snapshotLines = structure.split("\n").map((line) => line.trim());
      const [nodeLine] = (await modelSees.pageStateText())!.split("\n");
      expect(snapshotLines).toContain(nodeLine);
    });
  });
}
