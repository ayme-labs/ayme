import { describe } from "@e2e-dev/web";
import { expect } from "e2e";
import type { Agent } from "@ayme-dev/mcp/testing";

import {
  INSPECTOR,
  outline,
  placements,
  reloadFixture,
  testIn,
} from "./e2e/fixtures";

// E2E: running tools from the panel, on the fixture page with the real
// ListPage Page Object and the ayme runtime, in both placements of the
// Inspector. The app runs Browser Tools through its runtime, and an agent
// calls Page Object Tools over ayme MCP.

/** The failure text an agent gets calling a tool over ayme MCP. */
async function agentFailure(agent: Agent, name: string, input: object) {
  const { text, isError } = await agent.call(name, { ...input });
  if (!isError)
    throw new Error(`Expected ${name} to fail over ayme MCP: ${text}`);
  return text;
}

function firstLine(text: string | null | undefined) {
  return (text ?? "").split("\n")[0]!;
}

for (const placement of placements) {
  const test = testIn(placement);

  describe(placement, () => {
    test("a non-POM target keeps its accessible name after clicking removes it and after reload", async ({
      appView,
      browser,
      page,
      inspector,
    }) => {
      await page.front();
      await browser.evaluate(() => {
        const button = document.createElement("button");
        button.textContent = "Dismiss notice";
        button.addEventListener("click", () => button.remove());
        document.querySelector("main")!.append(button);
        return null;
      });
      const ref = await appView.ref('button "Dismiss notice"');
      await inspector.runs.showAll();
      await appView.run("click", { target: ref });
      const run = inspector.runs.latest("click");
      await expect
        .poll(async () => (await run.read())?.toggle)
        .toContain('button "Dismiss notice"');
      const shown = await run.read();
      expect(shown?.arguments).toBeNull();
      expect(shown?.interactions).toEqual([]);
      await expect.poll(async () => (await run.read())?.targetGone).toBe(true);
      await reloadFixture(page, "/");
      // Counted by e2e's replay cache, so the goal twin's goals are saved.
      await (
        await inspector.runs.runs.within((runs) => runs.first()).front()
      ).waitFor();
      await expect
        .poll(async () => (await inspector.runs.latest("click").read())?.toggle)
        .toContain('button "Dismiss notice"');
    });

    test("a Page Object Tool run from the panel shows in Runs as the Inspector's, with its Interactions", async ({
      inspector,
    }) => {
      await (await inspector.tool("ListPage.addItem")).run({ text: "Milk" });
      // Counted by e2e's replay cache, so the goal twin's goals are saved.
      await (
        await inspector.runs.runs.within((runs) => runs.first()).front()
      ).waitFor();

      const run = inspector.runs.latest("ListPage.addItem");
      await expect.poll(() => run.status()).toBe("Succeeded");
      expect(await run.caller()).toEqual(INSPECTOR);
      // ListPage.addItem fills the new item's text, then presses Add item.
      await expect
        .poll(() => run.interactionList())
        .toEqual([
          {
            operation: "fill",
            target: "ListPage.newItemInput",
            value: '"Milk"',
          },
          { operation: "click", target: "ListPage.addItemButton" },
        ]);
    });

    test("form fields keep their names and values without repeating their refs", async ({
      appView,
      inspector,
    }) => {
      const text = await appView.ref('textbox "New item"');
      const urgent = await appView.ref('checkbox "Urgent"');
      await inspector.runs.showAll();
      await appView.run("fill_form", {
        fields: [
          { name: "New item", type: "textbox", target: text, value: "Milk" },
          { name: "Urgent", type: "checkbox", target: urgent, value: "true" },
        ],
      });
      // Counted by e2e's replay cache, so the goal twin's goals are saved.
      await (
        await inspector.runs.runs.within((runs) => runs.first()).front()
      ).waitFor();
      const run = inspector.runs.latest("fill_form");
      await expect
        .poll(() => run.interactionList())
        .toEqual([
          {
            operation: "fill",
            target: "ListPage.newItemInput",
            value: '"Milk"',
          },
          { operation: "setChecked", target: "ListPage.newItemFields[1]" },
        ]);
      expect(JSON.parse((await run.read())?.arguments ?? "")).toEqual({
        fields: [
          { name: "New item", type: "textbox", value: "Milk" },
          { name: "Urgent", type: "checkbox", value: "true" },
        ],
      });
    });

    test("a selection's chosen values show beside its readable target", async ({
      appView,
      browser,
      page,
      inspector,
    }) => {
      await page.front();
      await browser.evaluate(() => {
        const select = document.createElement("select");
        select.setAttribute("aria-label", "Size");
        for (const name of ["Small", "Large"]) {
          const option = document.createElement("option");
          option.value = name;
          option.textContent = name;
          select.append(option);
        }
        document.querySelector("main")!.append(select);
        return null;
      });
      const target = await appView.ref('combobox "Size"');
      await inspector.runs.showAll();
      await appView.run("select_option", { target, values: ["Large"] });
      // Counted by e2e's replay cache, so the goal twin's goals are saved.
      await (
        await inspector.runs.runs.within((runs) => runs.first()).front()
      ).waitFor();
      const run = inspector.runs.latest("select_option");
      await expect
        .poll(async () => (await run.read())?.toggle)
        .toContain('["Large"]');
      const shown = await run.read();
      expect(shown?.toggle).toContain('combobox "Size"');
      expect(shown?.arguments).toBeNull();
    });

    test("hovering a run's Interaction highlights its element on the page", async ({
      browser,
      inspector,
      listPage,
    }) => {
      await (await inspector.tool("ListPage.addItem")).run({ text: "Milk" });
      const run = inspector.runs.latest("ListPage.addItem");
      await expect.poll(() => run.status()).toBe("Succeeded");

      await expect
        .poll(async () => (await run.interactionList())[1]?.target)
        .toBe("ListPage.addItemButton");

      await run.interactionTarget(1).hover();
      // Counted by e2e's replay cache, so the goal twin's goals are saved.
      await (await listPage.addItemButton.front()).waitFor();

      // The dashed hover highlight.
      await expect
        .poll(outline(listPage.addItemButton, browser))
        .toBe("dashed");
    });

    test("a Custom Tool runs from the panel and shows in Runs", async ({
      appView,
      inspector,
      listPage,
    }) => {
      // The Add item button's ref, as snapshot gives it.
      const ref = await appView.ref('button "Add item"');

      await (await inspector.tool("mark_element")).run({ ref });

      await expect(await listPage.addItemButton.front()).toHaveAttribute(
        "data-marked"
      );
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
      // "done" is the field's first choice, which it shows before any pick.
      await mark.field("state").selectOption("todo");
      await mark.runButton.click();

      const item = (text: string) =>
        listPage.items.within((items) => items.filter({ hasText: text }));
      await expect(await item("Eggs").front()).toHaveAttribute(
        "data-state",
        "todo"
      );
      await expect(await item("Milk").front()).not.toHaveAttribute(
        "data-state"
      );
    });

    test("Runs switches between the selection's runs and all runs with the mouse", async ({
      inspector,
    }) => {
      await (await inspector.tool("ListPage.countItems")).runButton.click();
      await inspector.navigator.item("ListPage.addItem").click();
      await expect(await inspector.runs.runs.front()).toHaveCount(0);

      await inspector.runs.showAll();
      await expect
        .poll(() => inspector.runs.latest("ListPage.countItems").caller())
        .toEqual(INSPECTOR);

      await inspector.runs.showSelection();
      await expect(await inspector.runs.runs.front()).toHaveCount(0);
    });

    // The fixture stubs the Goal Loop's decision (clear the list, then judge
    // the goal met), so this covers the panel's run, not the model's
    // judgement.
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
      await expect(await listPage.items.front()).toHaveCount(0);
      expect(await run.resultText()).toContain('"reason": "done"');
    });

    test("Clear empties Runs, and the run after it is the only one shown", async ({
      appView,
      inspector,
    }) => {
      await (await inspector.tool("ListPage.countItems")).runButton.click();
      await inspector.runs.showAll();
      await expect(await inspector.runs.runs.front()).toHaveCount(1);

      await inspector.runs.clear();
      await expect(await inspector.runs.runs.front()).toHaveCount(0);
      // Another tool, so the run Runs shows next is told apart from the
      // cleared one.
      await (await inspector.tool("page_objects")).runButton.click();

      await expect
        .poll(async () => (await appView.runs()).map(({ tool }) => tool))
        .toEqual(["ListPage.countItems", "page_objects"]);
      const newest = (await appView.runs()).at(-1)!;
      await expect(await inspector.runs.runs.front()).toHaveCount(1);
      await expect(await inspector.runs.runs.front()).toHaveAttribute(
        "aria-label",
        newest.tool
      );
      await expect
        .poll(() => inspector.runs.latest(newest.tool).status())
        .toBe("Succeeded");
    });

    test("a run's result copies as the page's Run log has it", async ({
      appView,
      inspector,
      listPage,
    }) => {
      // The config grants the clipboard.
      const clipboard = {
        write: async (text: string) => {
          await inspector.tab.front();
          await inspector.tab.browser.evaluate(
            (text: string) =>
              navigator.clipboard.writeText(text).then(() => null),
            text
          );
        },
        read: async () => {
          await inspector.tab.front();
          return inspector.tab.browser.evaluate(() =>
            navigator.clipboard.readText()
          );
        },
      };
      // Something else first, so a copy that never lands is told apart.
      await clipboard.write("not copied");
      await listPage.addItem("Milk");
      await (await inspector.tool("ListPage.countItems")).runButton.click();
      const run = inspector.runs.latest("ListPage.countItems");
      await expect.poll(() => run.status()).toBe("Succeeded");

      await run.copyResultButton.click();

      // The panel says so once the write resolved; the Inspector's tab stays
      // in front until the clipboard is read.
      await expect(await run.announced.front()).toHaveText("Copied");
      const copied = await clipboard.read();
      const logged = (await appView.runs()).at(-1)!;
      expect(JSON.parse(copied)).toEqual(logged.result);
    });

    test("press_key presses the key the page receives", async ({
      inspector,
      listPage,
    }) => {
      const pressKey = await inspector.tool("press_key");
      await pressKey.fill({ key: "F4" });

      await pressKey.runButton.click();

      // The fixture writes the function key it receives into the New item
      // field.
      await expect(await listPage.newItemInput.front()).toHaveValue("F4");
    });

    test("the fill_form editor fills only the fields still changed after an undo", async ({
      appView,
      inspector,
      listPage,
    }) => {
      const card = await inspector.tool("fill_form");
      const form = card.fillForm;

      await form.set("New item", "Milk");
      await form.set("Urgent", true);
      await form.undo("New item");
      await card.runButton.click();

      const run = inspector.runs.latest("fill_form");
      await expect.poll(() => run.status()).toBe("Succeeded");
      const { input } = (await appView.runs()).at(-1)!;
      expect(
        (input as { fields: { name: string }[] }).fields.map(({ name }) => name)
      ).toEqual(["Urgent"]);
      await expect(await listPage.urgentCheckbox.front()).toBeChecked();
      await expect(await listPage.newItemInput.front()).toHaveValue("");
    });

    test("generate_locator offers the locator of each target in each group", async ({
      appView,
      inspector,
    }) => {
      const groups = [
        [
          await appView.ref('button "Add item"'),
          await appView.ref('textbox "New item"'),
        ],
        [await appView.ref('button "Clear"')],
      ];
      const card = await inspector.tool("generate_locator");
      const { locatorGroups } = card;

      await locatorGroups.toggleFromTree(1, ...groups[0]!);
      await locatorGroups.addGroupButton.click();
      await locatorGroups.toggleFromTree(2, ...groups[1]!);
      await card.runButton.click();

      const expected = (await appView.run("generate_locator", {
        groups: groups.map((targets) => ({ targets })),
      })) as { groups: { locators: { target: string; locator: string }[] }[] };
      for (const [index, group] of expected.groups.entries())
        for (const { target, locator } of group.locators)
          await expect(
            await locatorGroups.locator(index + 1, target).front()
          ).toHaveText(locator);
    });
  });

  const connected = testIn(placement, "/", { connected: true });

  describe(`${placement} connected to an agent`, () => {
    connected(
      "an agent's call over ayme MCP shows in Runs as the agent's",
      async ({ mcpServer, inspector }) => {
        await mcpServer!.call("ListPage.addItem", { text: "Milk" });

        const run = inspector.runs.latest("ListPage.addItem");
        await expect.poll(() => run.status()).toBe("Succeeded");
        expect(await run.caller()).toEqual({
          icon: "Run by an agent through ayme MCP",
        });
        expect((await run.read())?.arguments).toBe('{"text":"Milk"}');
        await expect
          .poll(() => run.interactionList())
          .toEqual([
            {
              operation: "fill",
              target: "ListPage.newItemInput",
              value: '"Milk"',
            },
            { operation: "click", target: "ListPage.addItemButton" },
          ]);
      }
    );

    connected(
      "a tool that fails on the page shows its error",
      async ({ mcpServer, inspector, listPage }) => {
        // The tool's target is gone: the page no longer has its Add item button.
        await listPage.removeAddItemButton();
        const agentError = await agentFailure(mcpServer!, "ListPage.addItem", {
          text: "Milk",
        });

        const addItem = await inspector.tool("ListPage.addItem");
        await addItem.run({ text: "Milk" });
        // Counted by e2e's replay cache, so the goal twin's goals are saved.
        await (
          await inspector.runs.runs.within((runs) => runs.first()).front()
        ).waitFor();

        const run = inspector.runs.latest("ListPage.addItem");
        await expect.poll(() => run.status()).toBe("Failed");
        // The panel shows the error an agent gets for the same call. Its call
        // log varies with timing, so the first line is compared.
        // The error shows just after the status: wait for it, as Playwright's
        // `textContent()` waits for the element.
        await expect
          .poll(async () => firstLine((await run.read())?.error))
          .toBe(firstLine(agentError));
      }
    );
  });

  const unpublished = testIn(placement, "/unpublished.html");
  const unpublishedConnected = testIn(placement, "/unpublished.html", {
    connected: true,
  });

  describe(`${placement} with WebMCP publication off`, () => {
    describe("connected to an agent", () => {
      unpublishedConnected(
        "a Page Object tool that fails gives the text an agent gets for the same call",
        async ({ mcpServer, inspector, listPage }) => {
          await listPage.removeAddItemButton();
          const agentError = await agentFailure(
            mcpServer!,
            "ListPage.addItem",
            { text: "Milk" }
          );
          await (
            await inspector.tool("ListPage.addItem")
          ).run({ text: "Milk" });
          // Counted by e2e's replay cache, so the goal twin's goals are saved.
          await (
            await inspector.runs.runs.within((runs) => runs.first()).front()
          ).waitFor();

          const run = inspector.runs.latest("ListPage.addItem");
          await expect
            .poll(async () => (await run.read())?.earlierPage)
            .toBe(false);
          await expect.poll(() => run.status()).toBe("Failed");
          // The error shows just after the status: wait for it, as
          // Playwright's `textContent()` waits for the element.
          await expect
            .poll(async () => firstLine((await run.read())?.error))
            .toBe(firstLine(agentError));
        }
      );
    });

    unpublished(
      "a Page Object tool runs from the panel",
      async ({ inspector, listPage }) => {
        await (await inspector.tool("ListPage.addItem")).run({ text: "Milk" });

        await expect(
          await listPage.items
            .within((items) => items.filter({ hasText: "Milk" }))
            .front()
        ).toHaveCount(1);
        await expect
          .poll(() => inspector.runs.latest("ListPage.addItem").status())
          .toBe("Succeeded");
      }
    );

    unpublished(
      "a Custom Tool runs from the panel",
      async ({ inspector, listPage }) => {
        // The Add item button's ref, from snapshot run in the panel.
        const getPageContext = await inspector.tool("snapshot");
        await getPageContext.runButton.click();
        const run = inspector.runs.latest("snapshot");
        await expect.poll(() => run.status()).toBe("Succeeded");
        const structure = (await run.resultText()) ?? "";
        const ref = /(e\d+) button "Add item"/.exec(structure)?.[1];
        if (!ref) throw new Error(`No Add item button in:\n${structure}`);

        await (await inspector.tool("mark_element")).run({ ref });

        await expect(await listPage.addItemButton.front()).toHaveAttribute(
          "data-marked"
        );
        await expect
          .poll(() => inspector.runs.latest("mark_element").status())
          .toBe("Succeeded");
      }
    );

    unpublished(
      "snapshot runs from the panel and shows its result",
      async ({ inspector }) => {
        const getPageContext = await inspector.tool("snapshot");
        await getPageContext.runButton.click();

        const run = inspector.runs.latest("snapshot");
        await expect.poll(() => run.status()).toBe("Succeeded");
        await run.resultToggle.click();
        // Counted by e2e's replay cache, so the goal twin's goals are saved.
        await (
          await inspector.runs.runs.within((runs) => runs.first()).front()
        ).waitFor();
        await expect
          .poll(async () => (await run.read())?.result)
          .toContain('"structure"');
      }
    );
  });
}
