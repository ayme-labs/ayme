import type { Agent } from "@ayme-dev/mcp/testing";

import { AppView } from "./appView";
import { expect, INSPECTOR, outline, test } from "./fixtures";

// E2E: running tools from the panel, on the fixture page with the real
// ListPage Page Object and the ayme runtime. The app runs Browser Tools
// through its runtime, and an agent calls Page Object Tools over ayme MCP.

test("a non-POM target keeps its accessible name after clicking removes it and after reload", async ({
  page,
  inspector,
}) => {
  await page.evaluate(() => {
    const button = document.createElement("button");
    button.textContent = "Dismiss notice";
    button.addEventListener("click", () => button.remove());
    document.querySelector("main")!.append(button);
  });
  const app = new AppView(page);
  const ref = await app.ref('button "Dismiss notice"');
  await inspector.runs.showAll();
  await app.run("click", { target: ref });
  const run = inspector.runs.latest("click");
  await expect
    .poll(() => run.toggle.textContent())
    .toContain('button "Dismiss notice"');
  await expect(run.arguments).toHaveCount(0);
  await expect(run.interactions).toHaveCount(0);
  await expect(
    run.toggle.getByTitle(/^Not available to highlight:/)
  ).toHaveAttribute("data-gone", "true");
  await page.reload();
  await inspector.open();
  await inspector.runs.showAll();
  await expect
    .poll(() => inspector.runs.latest("click").toggle.textContent())
    .toContain('button "Dismiss notice"');
});

test("a Page Object Tool run from the panel shows in Runs as the Inspector's, with its Interactions", async ({
  inspector,
}) => {
  await (await inspector.tool("ListPage.addItem")).run({ text: "Milk" });

  const run = inspector.runs.latest("ListPage.addItem");
  await expect.poll(() => run.status()).toBe("Succeeded");
  expect(await run.caller()).toEqual(INSPECTOR);
  // ListPage.addItem fills the new item's text, then presses Add item.
  await expect
    .poll(() => run.interactionList())
    .toEqual([
      { operation: "fill", target: "ListPage.newItemInput", value: '"Milk"' },
      { operation: "click", target: "ListPage.addItemButton" },
    ]);
});

test("form fields keep their names and values without repeating their refs", async ({
  page,
  inspector,
}) => {
  const app = new AppView(page);
  const text = await app.ref('textbox "New item"');
  const urgent = await app.ref('checkbox "Urgent"');
  await inspector.runs.showAll();
  await app.run("fill_form", {
    fields: [
      { name: "New item", type: "textbox", target: text, value: "Milk" },
      { name: "Urgent", type: "checkbox", target: urgent, value: "true" },
    ],
  });
  const run = inspector.runs.latest("fill_form");
  await expect
    .poll(() => run.interactionList())
    .toEqual([
      { operation: "fill", target: "ListPage.newItemInput", value: '"Milk"' },
      { operation: "setChecked", target: "ListPage.newItemFields[1]" },
    ]);
  expect(JSON.parse((await run.arguments.textContent()) ?? "")).toEqual({
    fields: [
      { name: "New item", type: "textbox", value: "Milk" },
      { name: "Urgent", type: "checkbox", value: "true" },
    ],
  });
});

test("a selection's chosen values show beside its readable target", async ({
  page,
  inspector,
}) => {
  await page.evaluate(() => {
    const select = document.createElement("select");
    select.setAttribute("aria-label", "Size");
    for (const name of ["Small", "Large"]) {
      const option = document.createElement("option");
      option.value = name;
      option.textContent = name;
      select.append(option);
    }
    document.querySelector("main")!.append(select);
  });
  const app = new AppView(page);
  const target = await app.ref('combobox "Size"');
  await inspector.runs.showAll();
  await app.run("select_option", { target, values: ["Large"] });
  const run = inspector.runs.latest("select_option");
  await expect.poll(() => run.toggle.textContent()).toContain('["Large"]');
  expect(await run.toggle.textContent()).toContain('combobox "Size"');
  await expect(run.arguments).toHaveCount(0);
});

test("hovering a run's Interaction highlights its element on the page", async ({
  inspector,
  listPage,
}) => {
  await (await inspector.tool("ListPage.addItem")).run({ text: "Milk" });
  const run = inspector.runs.latest("ListPage.addItem");
  await expect.poll(() => run.status()).toBe("Succeeded");

  await expect
    .poll(() => run.interactionTarget(1).textContent())
    .toBe("ListPage.addItemButton");

  await run.interactionTarget(1).hover();

  // The dashed hover highlight.
  await expect.poll(outline(listPage.addItemButton)).toBe("dashed");
});

test.describe("connected to an agent", () => {
  test.use({ connected: true });

  test("an agent's call over ayme MCP shows in Runs as the agent's", async ({
    agent,
    inspector,
  }) => {
    await agent!.call("ListPage.addItem", { text: "Milk" });

    const run = inspector.runs.latest("ListPage.addItem");
    await expect.poll(() => run.status()).toBe("Succeeded");
    expect(await run.caller()).toEqual({
      icon: "Run by an agent through ayme MCP",
    });
    expect(await run.arguments.textContent()).toBe('{"text":"Milk"}');
    await expect
      .poll(() => run.interactionList())
      .toEqual([
        { operation: "fill", target: "ListPage.newItemInput", value: '"Milk"' },
        { operation: "click", target: "ListPage.addItemButton" },
      ]);
  });

  test("a tool that fails on the page shows its error", async ({
    agent,
    inspector,
    listPage,
  }) => {
    // The tool's target is gone: the page no longer has its Add item button.
    await listPage.addItemButton.evaluate((button) => button.remove());
    const agentError = await agentFailure(agent!, "ListPage.addItem", {
      text: "Milk",
    });

    const addItem = await inspector.tool("ListPage.addItem");
    await addItem.run({ text: "Milk" });

    const run = inspector.runs.latest("ListPage.addItem");
    await expect.poll(() => run.status()).toBe("Failed");
    // The panel shows the error an agent gets for the same call. Its call
    // log varies with timing, so the first line is compared.
    expect(firstLine(await run.error.textContent())).toBe(
      firstLine(agentError)
    );
  });
});

test("a Custom Tool runs from the panel and shows in Runs", async ({
  page,
  inspector,
  listPage,
}) => {
  // The Add item button's ref, as snapshot gives it.
  const ref = await new AppView(page).ref('button "Add item"');

  await (await inspector.tool("mark_element")).run({ ref });

  await expect(listPage.addItemButton).toHaveAttribute("data-marked");
  const run = inspector.runs.latest("mark_element");
  await expect.poll(() => run.status()).toBe("Succeeded");
  expect(await run.caller()).toEqual(INSPECTOR);
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
  const mark = await inspector.tool("ListItem.mark");

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
  await expect
    .poll(() => inspector.runs.latest("ListPage.countItems").caller())
    .toEqual(INSPECTOR);

  await inspector.runs.showSelection();
  await expect(inspector.runs.runs).toHaveCount(0);
});

// The fixture stubs the Goal Loop's decision (clear the list, then judge the
// goal met), so this covers the panel's run, not the model's judgement.
test("goal runs from the panel and shows in Runs with the Runs its steps executed and its Handover result", async ({
  inspector,
  listPage,
}) => {
  await listPage.addItem("Milk");

  const pursueGoal = await inspector.tool("goal");
  await pursueGoal.run({ goal: "Empty the list", maxSteps: 3 });

  const run = inspector.runs.latest("goal");
  await expect.poll(() => run.status()).toBe("Succeeded");
  expect(await run.caller()).toEqual(INSPECTOR);
  // Its one step cleared the list: a child Run, whose click is its own.
  expect(await run.childTools()).toEqual(["ListPage.clear"]);
  await expect
    .poll(() => run.child("ListPage.clear").interactionList())
    .toEqual([{ operation: "click", target: "ListPage.clearButton" }]);
  await expect(listPage.items).toHaveCount(0);
  expect(await run.resultText()).toContain('"reason": "done"');
});

test.describe("with WebMCP publication off", () => {
  test.use({ fixturePath: "/unpublished.html" });

  test.describe("connected to an agent", () => {
    test.use({ connected: true });

    test("a Page Object tool that fails gives the text an agent gets for the same call", async ({
      agent,
      inspector,
      listPage,
    }) => {
      await listPage.addItemButton.evaluate((button) => button.remove());
      const agentError = await agentFailure(agent!, "ListPage.addItem", {
        text: "Milk",
      });

      await (await inspector.tool("ListPage.addItem")).run({ text: "Milk" });

      const run = inspector.runs.latest("ListPage.addItem");
      await expect.poll(() => run.earlierPage.count()).toBe(0);
      await expect.poll(() => run.status()).toBe("Failed");
      expect(firstLine(await run.error.textContent())).toBe(
        firstLine(agentError)
      );
    });
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
    // The Add item button's ref, from snapshot run in the panel.
    const getPageContext = await inspector.tool("snapshot");
    await getPageContext.runButton.click();
    const run = inspector.runs.latest("snapshot");
    await expect.poll(() => run.status()).toBe("Succeeded");
    const structure = (await run.resultText()) ?? "";
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

/** The failure text an agent gets calling a tool over ayme MCP. */
async function agentFailure(agent: Agent, name: string, input: object) {
  const { text, isError } = await agent.call(name, { ...input });
  if (!isError)
    throw new Error(`Expected ${name} to fail over ayme MCP: ${text}`);
  return text;
}

function firstLine(text: string | null) {
  return (text ?? "").split("\n")[0]!;
}

test("Clear empties Runs, and a run after it shows", async ({
  page,
  inspector,
}) => {
  const countItems = await inspector.tool("ListPage.countItems");
  await countItems.runButton.click();
  await inspector.runs.showAll();
  await expect(inspector.runs.runs).toHaveCount(1);

  await inspector.runs.clear();
  await expect(inspector.runs.runs).toHaveCount(0);
  await countItems.runButton.click();

  await expect(inspector.runs.runs).toHaveCount(1);
  const newest = (await new AppView(page).runs()).at(-1)!;
  await expect
    .poll(() => inspector.runs.latest(newest.tool).status())
    .toBe("Succeeded");
});

test("a run's result copies as the page's Run log has it", async ({
  page,
  context,
  inspector,
  listPage,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await listPage.addItem("Milk");
  await (await inspector.tool("ListPage.countItems")).runButton.click();
  const run = inspector.runs.latest("ListPage.countItems");
  await expect.poll(() => run.status()).toBe("Succeeded");

  await run.copyResultButton.click();

  const logged = (await new AppView(page).runs()).at(-1)!;
  const copied = await inspector.panel
    .page()
    .evaluate(() => navigator.clipboard.readText());
  expect(JSON.parse(copied)).toEqual(logged.result);
});

test("press_key presses a key the page reacts to", async ({
  inspector,
  listPage,
}) => {
  const pressKey = await inspector.tool("press_key");
  await pressKey.fill({ key: "F2" });
  // The fixture's F2 clears the New item field.
  await listPage.newItemInput.fill("Milk");

  await pressKey.runButton.click();

  await expect(listPage.newItemInput).toHaveValue("");
});

test("the fill_form editor fills the fields still changed after an undo", async ({
  page,
  inspector,
  listPage,
}) => {
  const card = await inspector.tool("fill_form");
  await card.openArguments();
  const form = card.fillForm;

  await form.set("New item", "Milk");
  await form.set("Urgent", true);
  await form.undo("Urgent");
  await card.runButton.click();

  await expect(listPage.newItemInput).toHaveValue("Milk");
  await expect(
    page.getByRole("checkbox", { name: "Urgent" })
  ).not.toBeChecked();
});

test("generate_locator offers the locator of each target chosen for a group", async ({
  page,
  inspector,
}) => {
  const app = new AppView(page);
  const ref = await app.ref('button "Add item"');
  const card = await inspector.tool("generate_locator");
  await card.openArguments();

  await card.locatorGroups.toggleFromTree(1, ref);
  await card.runButton.click();

  const { groups } = (await app.run("generate_locator", {
    groups: [{ targets: [ref] }],
  })) as { groups: { locators: { locator: string }[] }[] };
  await expect(card.locatorGroups.locator(1, ref)).toHaveText(
    groups[0]!.locators[0]!.locator
  );
});
