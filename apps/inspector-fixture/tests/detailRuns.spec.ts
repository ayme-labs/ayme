import { AppView } from "./appView";
import { expect, INSPECTOR, test } from "./fixtures";

// E2E: the lenses, the run card, Runs and What the model sees working
// together on the fixture page, with the real runtime. Expected values come
// from the page and its runtime, never from the panel.

test("a structure node's Browser tool runs on that node, and Runs shows the run as yours", async ({
  inspector,
  listPage,
}) => {
  await inspector.navigator.showLens("Structure");
  await inspector.structure.nodeOf("ListPage.newItemInput").click();
  const fill = inspector.detail.node.runCard("fill");

  await fill.run({ text: "Bread" });

  await expect(listPage.newItemInput).toHaveValue("Bread");
  const run = inspector.runs.latest("fill");
  await expect.poll(() => run.status()).toBe("Succeeded");
  expect(await run.caller()).toEqual(INSPECTOR);
});

test("a tool's page runs it from a card without a head, and What the model sees shows the definition snapshot gives", async ({
  page,
  inspector,
  listPage,
}) => {
  const app = new AppView(page);
  const addItem = (await app.tools()).find(
    ({ name }) => name === "ListPage.addItem"
  )!;
  const definition = await app.pomDefinitions("ListPage");
  const { toolPage } = inspector.detail;

  const card = await inspector.tool("ListPage.addItem");

  await expect
    .poll(() => toolPage.descriptionText())
    .toBe(addItem.agentDescription ?? "");
  await expect(card.argumentsToggle).toHaveCount(0);
  await card.run({ text: "Bread" });
  await expect(listPage.items.filter({ hasText: "Bread" })).toHaveCount(1);
  await toolPage.modelSees.open();
  await expect
    .poll(() => toolPage.modelSees.definitions.textContent())
    .toBe(definition);
});

test("a checked checkbox reads as checked in its node's What the model sees, as in the page state snapshot gives", async ({
  page,
  inspector,
}) => {
  await inspector.navigator.showLens("Structure");
  await inspector.structure.nodeNamed("checkbox", "Urgent").click();
  const { modelSees } = inspector.detail.node;
  await modelSees.open();

  await page.getByRole("checkbox", { name: "Urgent" }).check();

  await expect(modelSees.pageState).toContainText("[checked]");
  const structure = await new AppView(page).structure();
  const snapshotLines = structure.split("\n").map((line) => line.trim());
  const [nodeLine] = (await modelSees.pageState.textContent())!.split("\n");
  expect(snapshotLines).toContain(nodeLine);
});
