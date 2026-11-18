import { describe, test as plainTest } from "@e2e-dev/web";
import { expect, type JsonValue } from "e2e";

import type { AgentView } from "./e2e/agentView";
import {
  INSPECTOR,
  openFixture,
  outline,
  placements,
  reloadFixture,
  testIn,
} from "./e2e/fixtures";

// E2E: running tools from the panel, on the fixture page with the real
// ListPage Page Object, the Ayme runtime and a recording WebMCP driver, in
// both placements of the Inspector.

/** The failure text an agent gets calling a tool over WebMCP. */
async function agentFailure(
  agentView: AgentView,
  name: string,
  input: { [key: string]: JsonValue }
) {
  const failure = (await agentView.call(name, input)) as {
    isError?: boolean;
    content?: { text: string }[];
  } | null;
  if (!failure?.isError)
    throw new Error(
      `Expected ${name} to fail over WebMCP: ${JSON.stringify(failure)}`
    );
  return failure.content![0]!.text;
}

function firstLine(text: string | null | undefined) {
  return (text ?? "").split("\n")[0]!;
}

for (const placement of placements) {
  const test = testIn(placement);

  describe(placement, () => {
    test("a non-POM target keeps its accessible name after clicking removes it and after reload", async ({
      agentView,
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
      const ref = await agentView.ref('button "Dismiss notice"');
      await inspector.runs.showAll();
      await agentView.call("click", { target: ref });
      const run = inspector.runs.latest("click");
      await expect
        .poll(async () => (await run.read())?.toggle)
        .toContain('button "Dismiss notice"');
      const shown = await run.read();
      expect(shown?.arguments).toBeNull();
      expect(shown?.interactions).toEqual([]);
      await expect.poll(async () => (await run.read())?.targetGone).toBe(true);
      await reloadFixture(page, "/");
      await inspector.open();
      await inspector.runs.showAll();
      await expect
        .poll(async () => (await inspector.runs.latest("click").read())?.toggle)
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
          {
            operation: "fill",
            target: "ListPage.newItemInput",
            value: '"Milk"',
          },
          { operation: "click", target: "ListPage.addItemButton" },
        ]);
    });

    test("form fields keep their names and values without repeating their refs", async ({
      agentView,
      inspector,
    }) => {
      const text = await agentView.ref('textbox "New item"');
      const urgent = await agentView.ref('checkbox "Urgent"');
      await inspector.runs.showAll();
      await agentView.call("fill_form", {
        fields: [
          { name: "New item", type: "textbox", target: text, value: "Milk" },
          { name: "Urgent", type: "checkbox", target: urgent, value: "true" },
        ],
      });
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
      agentView,
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
      const target = await agentView.ref('combobox "Size"');
      await inspector.runs.showAll();
      await agentView.call("select_option", { target, values: ["Large"] });
      const run = inspector.runs.latest("select_option");
      await expect
        .poll(async () => (await run.read())?.toggle)
        .toContain('["Large"]');
      const shown = await run.read();
      expect(shown?.toggle).toContain('combobox "Size"');
      expect(shown?.arguments).toBeNull();
    });

    test("an agent's call over WebMCP shows in Runs as the agent's", async ({
      agentView,
      inspector,
    }) => {
      await agentView.call("ListPage.addItem", { text: "Milk" });

      const run = inspector.runs.latest("ListPage.addItem");
      await expect.poll(() => run.status()).toBe("Succeeded");
      expect(await run.caller()).toEqual({
        icon: "Run by an agent through WebMCP",
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

      // The dashed hover highlight.
      await expect
        .poll(outline(listPage.addItemButton, browser))
        .toBe("dashed");
    });

    test("a tool that fails on the page shows its error", async ({
      agentView,
      inspector,
      listPage,
    }) => {
      // The tool's target is gone: the page no longer has its Add item button.
      await listPage.removeAddItemButton();
      const agentError = await agentFailure(agentView, "ListPage.addItem", {
        text: "Milk",
      });

      const addItem = await inspector.tool("ListPage.addItem");
      await addItem.run({ text: "Milk" });

      const run = inspector.runs.latest("ListPage.addItem");
      await expect.poll(() => run.status()).toBe("Failed");
      // The panel shows the error an agent gets for the same call. Its call
      // log varies with timing, so the first line is compared.
      expect(firstLine((await run.read())?.error)).toBe(firstLine(agentError));
    });

    test("a Custom Tool runs from the panel and shows in Runs", async ({
      agentView,
      inspector,
      listPage,
    }) => {
      // The Add item button's ref, as an agent reads it from snapshot.
      const ref = await agentView.ref('button "Add item"');

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
      await mark.field("state").selectOption("done");
      await mark.runButton.click();

      const item = (text: string) =>
        listPage.items.within((items) => items.filter({ hasText: text }));
      await expect(await item("Eggs").front()).toHaveAttribute(
        "data-state",
        "done"
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
  });

  const unpublished = testIn(placement, "/unpublished.html");

  describe(`${placement} with WebMCP publication off`, () => {
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
        // The Add item button's ref, from snapshot run in the panel:
        // with publication off, no agent can call it.
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
        await expect
          .poll(async () => (await run.read())?.result)
          .toContain('"structure"');
      }
    );
  });
}

// Inline only: it opens fixture pages of its own, as the Playwright version,
// whose external project ran it inline too.
plainTest(
  "with WebMCP publication off, a Page Object tool that fails gives the text an agent gets for the same call",
  async (fixtures) => {
    // What an agent gets on the published page: the Add item button is gone.
    const published = await openFixture(fixtures, "/");
    await published.listPage.removeAddItemButton();
    const agentError = await agentFailure(
      published.agentView,
      "ListPage.addItem",
      { text: "Milk" }
    );

    const { inspector, listPage } = await openFixture(
      fixtures,
      "/unpublished.html"
    );
    await listPage.removeAddItemButton();
    await (await inspector.tool("ListPage.addItem")).run({ text: "Milk" });

    const run = inspector.runs.latest("ListPage.addItem");
    await expect.poll(async () => (await run.read())?.earlierPage).toBe(false);
    await expect.poll(() => run.status()).toBe("Failed");
    expect(firstLine((await run.read())?.error)).toBe(firstLine(agentError));
  }
);
