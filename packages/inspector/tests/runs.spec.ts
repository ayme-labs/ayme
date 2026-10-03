import type { Page } from "@playwright/test";
import { executePublishedTool } from "@ayme-dev/ayme/testing";

import { AgentView } from "./agentView";
import { expect, openFixture, test } from "./fixtures";

// E2E: running tools from the panel, on the fixture page with the real
// ListPage Page Object, the Ayme runtime and a recording WebMCP driver.

test("a run from the panel shows in Runs, marked as yours, with its steps", async ({
  inspector,
}) => {
  await (await inspector.tool("ListPage.addItem")).run({ text: "Milk" });

  const run = inspector.runs.latest("ListPage.addItem");
  await expect.poll(() => run.status()).toBe("Succeeded");
  await expect(run.byYou).toBeVisible();
  // ListPage.addItem fills the new item's text, then presses Add item.
  expect(await run.stepList()).toEqual([
    { operation: "fill", target: "ListPage.newItemInput", value: '"Milk"' },
    { operation: "click", target: "ListPage.addItemButton" },
  ]);
});

test("hovering a run's step highlights its element on the page", async ({
  inspector,
  listPage,
}) => {
  await (await inspector.tool("ListPage.addItem")).run({ text: "Milk" });
  const run = inspector.runs.latest("ListPage.addItem");
  await expect.poll(() => run.status()).toBe("Succeeded");

  await run.stepTarget(1).hover();

  // The dashed hover highlight.
  await expect(listPage.addItemButton).toHaveAttribute("data-ayme-hover");
});

test("a tool that fails on the page shows its error", async ({
  page,
  inspector,
  listPage,
}) => {
  // The tool's target is gone: the page no longer has its Add item button.
  await listPage.addItemButton.evaluate((button) => button.remove());
  const agentError = await agentFailure(page, "ListPage.addItem", {
    text: "Milk",
  });

  const addItem = await inspector.tool("ListPage.addItem");
  await addItem.run({ text: "Milk" });

  const run = inspector.runs.latest("ListPage.addItem");
  await expect.poll(() => run.status()).toBe("Failed");
  // The panel shows the error an agent gets for the same call. Its call log
  // varies with timing, so the first line is compared.
  expect(firstLine(await run.error.textContent())).toBe(firstLine(agentError));
});

test("a Custom Tool runs from the panel and shows in Runs", async ({
  page,
  inspector,
  listPage,
}) => {
  // The Add item button's ref, as an agent reads it from snapshot.
  const ref = await new AgentView(page).ref('button "Add item"');

  await (await inspector.tool("mark_element")).run({ ref });

  await expect(listPage.addItemButton).toHaveAttribute("data-marked");
  const run = inspector.runs.latest("mark_element");
  await expect.poll(() => run.status()).toBe("Succeeded");
  await expect(run.byYou).toBeVisible();
});

// The run card's and Runs' own choices, made with the mouse in the closed
// shadow root the Inspector mounts in. None of them is a popup that could
// close before the press lands.
test("a collection action runs on the item and choice picked with the mouse", async ({
  inspector,
  listPage,
}) => {
  await listPage.addItem("Milk");
  await listPage.addItem("Eggs");
  const mark = await inspector.tool("ListPage.entries.mark");

  await mark.pickItem("Eggs");
  await mark.jsonSwitch.click();
  await mark.formSwitch.click();
  await mark.field("state").selectOption({ label: "done" });
  await mark.runButton.click();

  await expect(listPage.items.filter({ hasText: "Eggs" })).toHaveAttribute(
    "data-state",
    "done"
  );
  await expect(listPage.items.filter({ hasText: "Milk" })).not.toHaveAttribute(
    "data-state"
  );
});

test("Runs switches between the selection's runs and all runs with the mouse", async ({
  inspector,
}) => {
  await (await inspector.tool("ListPage.countItems")).runButton.click();
  await inspector.navigator.item("ListPage.addItem").click();
  await expect(inspector.runs.runs).toHaveCount(0);

  await inspector.runs.showAll();
  await expect(
    inspector.runs.latest("ListPage.countItems").byYou
  ).toBeVisible();

  await inspector.runs.showSelection();
  await expect(inspector.runs.runs).toHaveCount(0);
});

// The fixture stubs the Goal Loop's decision (clear the list, then judge the
// goal met), so this covers the panel's run, not the model's judgement.
test("goal runs from the panel and shows in Runs with its steps and Handover result", async ({
  inspector,
  listPage,
}) => {
  await listPage.addItem("Milk");

  const pursueGoal = await inspector.tool("goal");
  await pursueGoal.run({ goal: "Empty the list", maxSteps: 3 });

  const run = inspector.runs.latest("goal");
  await expect.poll(() => run.status()).toBe("Succeeded");
  await expect(run.byYou).toBeVisible();
  expect(await run.stepList()).toContainEqual({
    operation: "click",
    target: "ListPage.clearButton",
  });
  await expect(listPage.items).toHaveCount(0);
  const handover = JSON.parse((await run.resultText()) ?? "");
  expect(handover).toMatchObject({ reason: "done" });
});

test.describe("with WebMCP publication off", () => {
  test.use({ fixturePath: "/unpublished.html" });

  test("a Page Object tool that fails gives the text an agent gets for the same call", async ({
    page,
  }) => {
    // What an agent gets on the published page: the Add item button is gone.
    const published = await openFixture(page, "/");
    await published.listPage.addItemButton.evaluate((button) =>
      button.remove()
    );
    const agentError = await agentFailure(page, "ListPage.addItem", {
      text: "Milk",
    });

    const { inspector, listPage } = await openFixture(
      page,
      "/unpublished.html"
    );
    await listPage.addItemButton.evaluate((button) => button.remove());
    await (await inspector.tool("ListPage.addItem")).run({ text: "Milk" });

    const run = inspector.runs.latest("ListPage.addItem");
    await expect.poll(() => run.status()).toBe("Failed");
    expect(firstLine(await run.error.textContent())).toBe(
      firstLine(agentError)
    );
  });

  test("a Page Object tool runs from the panel", async ({
    inspector,
    listPage,
  }) => {
    await (await inspector.tool("ListPage.addItem")).run({ text: "Milk" });

    await expect(listPage.items.filter({ hasText: "Milk" })).toHaveCount(1);
    await expect
      .poll(() => inspector.runs.latest("ListPage.addItem").status())
      .toBe("Succeeded");
  });

  test("a Custom Tool runs from the panel", async ({ inspector, listPage }) => {
    // The Add item button's ref, from snapshot run in the panel:
    // with publication off, no agent can call it.
    const getPageContext = await inspector.tool("snapshot");
    await getPageContext.runButton.click();
    const run = inspector.runs.latest("snapshot");
    await expect.poll(() => run.status()).toBe("Succeeded");
    const { structure } = JSON.parse((await run.resultText()) ?? "{}") as {
      structure: string;
    };
    const ref = /(e\d+) button "Add item"/.exec(structure)?.[1];
    if (!ref) throw new Error(`No Add item button in:\n${structure}`);

    await (await inspector.tool("mark_element")).run({ ref });

    await expect(listPage.addItemButton).toHaveAttribute("data-marked");
    await expect
      .poll(() => inspector.runs.latest("mark_element").status())
      .toBe("Succeeded");
  });

  test("snapshot runs from the panel and shows its result", async ({
    inspector,
  }) => {
    const getPageContext = await inspector.tool("snapshot");
    await getPageContext.runButton.click();

    const run = inspector.runs.latest("snapshot");
    await expect.poll(() => run.status()).toBe("Succeeded");
    await run.resultToggle.click();
    await expect(run.result).toContainText('"structure"');
  });
});

/** The failure text an agent gets calling a tool over WebMCP. */
async function agentFailure(page: Page, name: string, input: object) {
  const failure = (await executePublishedTool(page, name, input)) as {
    isError?: boolean;
    content?: { text: string }[];
  } | null;
  if (!failure?.isError)
    throw new Error(
      `Expected ${name} to fail over WebMCP: ${JSON.stringify(failure)}`
    );
  return failure.content![0]!.text;
}

function firstLine(text: string | null) {
  return (text ?? "").split("\n")[0]!;
}
