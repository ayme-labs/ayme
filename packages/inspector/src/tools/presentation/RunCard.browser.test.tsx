import { afterEach, describe, expect, it, vi } from "vitest";
import { createPage } from "@ayme-dev/playwright-lite";

import type { RunnableTool } from "../domain/runnableTools";
import { forest, node } from "../../structure/test-utils/projected";
import { buildStructureTree } from "../../structure";
import {
  aChildRun,
  anInteraction,
  anItem,
  aRun,
} from "../../runs/test-utils/runs";
import { renderPart } from "../../testing/renderPart";
import { RunCard as RunCardPart } from "../../testing";
import { argumentViolationsOf } from "../infrastructure/argumentViolations";
import { schemaText } from "../infrastructure/schemaText";
import { RunCard, type RunCardProps } from "./RunCard";

// Component tests: the run card with fixture tools and runs, driven through
// its page object on playwright-lite. Each checks what the card shows and
// what it asks to run.

const page = createPage();
const unmounts: (() => void)[] = [];

afterEach(() => {
  for (const unmount of unmounts.splice(0)) unmount();
});

const clearList: RunnableTool = {
  name: "ListPage.clearList",
  action: "clearList",
  description: "Remove every item.",
  present: true,
  available: true,
  argumentsSchema: { type: "object", properties: {} },
};

const addItem: RunnableTool = {
  name: "ListPage.addItem",
  action: "addItem",
  description: "Add an item to the list.",
  present: true,
  available: true,
  argumentsSchema: {
    type: "object",
    properties: {
      text: { type: "string" },
      copies: { type: "integer" },
      urgent: { type: "boolean" },
      priority: { type: "string", enum: ["low", "normal", "high"] },
      details: {
        type: "object",
        properties: {
          contact: { type: "string", format: "email" },
          tags: { type: "array", items: { type: "string" } },
        },
      },
    },
    required: ["text"],
  } as RunnableTool["argumentsSchema"],
};

const rename: RunnableTool = {
  name: "ListPage.items.rename",
  action: "rename",
  description: "Rename this item.",
  present: true,
  available: true,
  argumentsSchema: {
    type: "object",
    properties: { text: { type: "string" } },
    required: ["text"],
  },
  collection: "ListPage.items[]",
};

const milk = anItem("ListPage.items[0]", { ref: "e3", label: "Milk" });
const eggs = anItem("ListPage.items[1]", { ref: "e6", label: "Eggs" });

function renderCard(props: Partial<RunCardProps> & Pick<RunCardProps, "tool">) {
  const onRun = vi.fn();
  const onShowRun = vi.fn();
  unmounts.push(
    renderPart(
      <RunCard
        schemaText={schemaText}
        runs={[]}
        onRun={onRun}
        onShowRun={onShowRun}
        argumentViolations={argumentViolationsOf(props.tool)}
        {...props}
      />
    )
  );
  const card = new RunCardPart(
    page.getByRole("form", { name: props.tool.action, exact: true })
  );
  return { card, onRun, onShowRun };
}

describe("Run", () => {
  it("runs at once when the tool takes nothing", async () => {
    const { card, onRun } = renderCard({ tool: clearList });

    await card.runButton.click();

    expect(onRun).toHaveBeenCalledExactlyOnceWith({});
    expect(await card.root.getAttribute("data-available")).toBe("true");
  });

  it("opens the typed form first when an argument is required", async () => {
    const { card, onRun } = renderCard({ tool: addItem });

    await expect.poll(() => card.runButton.count()).toBe(1);
    expect(await card.field("text").count()).toBe(0);
    await card.runButton.click();

    await expect.poll(() => card.field("text").count()).toBe(1);
    expect(onRun).not.toHaveBeenCalled();

    await card.field("text").fill("Milk");
    await card.runButton.click();

    expect(onRun).toHaveBeenCalledExactlyOnceWith({ text: "Milk" });
  });

  it("is not there, with its form, on an action whose Page Object isn't on the page", async () => {
    const { card } = renderCard({
      tool: { ...addItem, present: false, available: false },
    });

    await expect.poll(() => card.root.count()).toBe(1);
    expect(await card.root.getAttribute("data-available")).toBe("false");
    expect(await card.runButton.count()).toBe(0);
    expect(await card.argumentsToggle.count()).toBe(0);
    expect(await card.field("text").count()).toBe(0);
    expect(await card.reason.count()).toBe(0);
  });

  it("says why an action is unavailable, and stays runnable so the refusal can be checked", async () => {
    const { card, onRun } = renderCard({
      tool: { ...clearList, available: false, reason: "Nothing to clear" },
    });

    await expect.poll(() => card.reason.textContent()).toBe("Nothing to clear");
    expect(await card.reason.count()).toBe(1);
    expect(await card.root.getAttribute("data-available")).toBe("false");
    expect(await card.runButton.isDisabled()).toBe(false);

    await card.runButton.click();

    expect(onRun).toHaveBeenCalledExactlyOnceWith({});
  });

  it("says why on a card without a head too", async () => {
    const { card } = renderCard({
      tool: { ...addItem, available: false, reason: "Nothing to add" },
      head: false,
    });

    await expect.poll(() => card.reason.textContent()).toBe("Nothing to add");
    expect(await card.reason.count()).toBe(1);
  });

  it("sits at the foot of an open form on a card without a head", async () => {
    const { card, onRun } = renderCard({ tool: addItem, head: false });

    await card.field("text").fill("Milk");
    await card.runButton.click();

    expect(await card.argumentsToggle.count()).toBe(0);
    expect(onRun).toHaveBeenCalledExactlyOnceWith({ text: "Milk" });
  });
});

describe("the types agents read", () => {
  const shapes: RunnableTool = {
    name: "ListPage.shapes",
    action: "shapes",
    description: "Take every schema shape.",
    present: true,
    available: true,
    argumentsSchema: {
      type: "object",
      properties: {
        value: { anyOf: [{ type: "string" }, { type: "number" }] },
        point: {
          type: "array",
          prefixItems: [{ type: "number" }, { type: "string" }],
          minItems: 2,
          maxItems: 2,
        },
        refs: { type: "array", items: { type: "string" } },
      },
      required: ["value", "point"],
    },
  };

  it("shows the signature and a JSON field's type the way the definition text writes them", async () => {
    const { card } = renderCard({ tool: shapes });

    await card.openArguments();

    await expect
      .poll(() => card.root.textContent())
      .toContain(
        "(value: string | number, point: [number, string], refs?: string[])"
      );
    const text = await card.root.textContent();
    expect(text).toContain("valuestring | number");
    expect(text).toContain("point[number, string]");
  });
});

describe("the typed form", () => {
  it("runs with text, integers, booleans, choices, lists and optional objects", async () => {
    const { card, onRun } = renderCard({ tool: addItem });

    await card.run({
      text: "Milk",
      copies: 3,
      urgent: true,
      priority: "high",
      details: { contact: "ann@example.com", tags: ["home", "weekly"] },
    });

    expect(onRun).toHaveBeenCalledExactlyOnceWith({
      text: "Milk",
      copies: 3,
      urgent: true,
      priority: "high",
      details: { contact: "ann@example.com", tags: ["home", "weekly"] },
    });
  });

  it("reports where invalid JSON goes wrong, and Run is off", async () => {
    const { card } = renderCard({ tool: addItem });

    await card.fillJson('{\n  "text": "Eggs"\n  "copies": 2\n}');

    await expect
      .poll(() => card.jsonError.textContent())
      .toBe(
        "Invalid JSON at line 3, column 3: expected ',' or '}', found '\"'."
      );
    expect(await card.runButton.isDisabled()).toBe(true);
    expect(await card.formatButton.isDisabled()).toBe(true);
  });

  it("lists how the arguments break the schema, by path, until they're fixed", async () => {
    const { card, onRun } = renderCard({ tool: addItem });

    await card.fillJson(
      '{ "copies": 1.5, "priority": "urgent", "details": { "tags": ["home", 2] }, "note": "x" }'
    );

    await expect
      .poll(() => card.schemaErrors.allTextContents())
      .toEqual([
        "copies: must be an integer",
        "priority: must be one of low, normal, high",
        "details.tags[1]: must be a string",
        "note: is not supported",
        "text: is required",
      ]);
    expect(await card.runButton.isDisabled()).toBe(true);

    await card.jsonEditor.fill('{ "text": "Eggs", "priority": "high" }');
    await expect.poll(() => card.schemaErrors.count()).toBe(0);
    await card.runButton.click();
    expect(onRun).toHaveBeenCalledExactlyOnceWith({
      text: "Eggs",
      priority: "high",
    });
  });

  it("formats valid JSON", async () => {
    const { card } = renderCard({ tool: addItem });

    await card.fillJson('{"text":"Eggs","details":{"tags":["home"]}}');
    await card.formatButton.click();

    expect(await card.jsonEditor.inputValue()).toBe(
      '{\n  "text": "Eggs",\n  "details": {\n    "tags": [\n      "home"\n    ]\n  }\n}'
    );
  });

  it("runs with the arguments typed as JSON", async () => {
    const { card, onRun } = renderCard({ tool: addItem });

    await card.fillJson('{ "text": "Eggs", "copies": 2 }');
    await card.runButton.click();

    expect(onRun).toHaveBeenCalledExactlyOnceWith({ text: "Eggs", copies: 2 });
  });

  it("keeps the arguments when switching between Form and JSON", async () => {
    const { card } = renderCard({ tool: addItem });

    await card.fill({ text: "Milk" });
    await card.jsonSwitch.click();

    await expect
      .poll(async () =>
        JSON.parse((await card.jsonEditor.inputValue()) || "{}")
      )
      .toEqual({ text: "Milk" });
    await card.jsonEditor.fill('{ "text": "Eggs" }');
    await card.formSwitch.click();
    expect(await card.field("text").inputValue()).toBe("Eggs");
  });
});

describe("a map of labelled values", () => {
  const VALUES_DESCRIPTION =
    "Passed to the Goal Loop with the goal. Where the page has nothing to pick, such as text to type or a URL to open, the loop picks one of these by its label. It never makes up a value.";

  // The goal tool's schema: its `values` map takes strings or numbers.
  const goal: RunnableTool = {
    name: "goal",
    action: "goal",
    description: "Drive the page toward a goal in steps.",
    present: true,
    available: true,
    argumentsSchema: {
      type: "object",
      properties: {
        goal: { type: "string" },
        maxSteps: { type: "integer" },
        values: {
          type: "object",
          description: VALUES_DESCRIPTION,
          additionalProperties: {
            anyOf: [{ type: "string" }, { type: "number" }],
          },
          minProperties: 1,
          maxProperties: 254,
        },
      },
      required: ["goal", "maxSteps"],
    },
  };

  async function openGoal() {
    const rendered = renderCard({ tool: goal });
    await rendered.card.fill({ goal: "Add an item called Milk", maxSteps: 5 });
    return { ...rendered, rows: rendered.card.valueRows("values") };
  }

  it("edits the map as rows, guessing each value's type as it is typed", async () => {
    const { card, onRun, rows } = await openGoal();

    expect(await rows.description.textContent()).toBe(VALUES_DESCRIPTION);
    await rows.addButton.click();
    await rows.label(1).fill("item name");
    await rows.value(1).fill("Milk");
    await rows.addButton.click();
    await rows.label(2).fill("quantity");
    await rows.value(2).fill("2");
    await rows.addButton.click();
    await rows.label(3).fill("zip");
    await rows.value(3).fill("02134");

    await expect.poll(() => rows.typeState(1)).toBe("auto · text");
    expect(await rows.typeState(2)).toBe("auto · number");
    // A leading zero is kept: the value stays text.
    expect(await rows.typeState(3)).toBe("auto · text");
    expect(await rows.count.textContent()).toBe("3 / 254");

    await card.runButton.click();
    expect(onRun).toHaveBeenCalledExactlyOnceWith({
      goal: "Add an item called Milk",
      maxSteps: 5,
      values: { "item name": "Milk", quantity: 2, zip: "02134" },
    });
  });

  it("keeps a fixed type while the value changes", async () => {
    const { card, onRun, rows } = await openGoal();

    await rows.addButton.click();
    await rows.label(1).fill("code");
    await rows.value(1).fill("7");
    // The guess is number; a click fixes the other type.
    await rows.type(1).click();
    await expect.poll(() => rows.typeState(1)).toBe("text");
    await rows.value(1).fill("42");

    expect(await rows.typeState(1)).toBe("text");
    await card.runButton.click();
    expect(onRun).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ values: { code: "42" } })
    );
  });

  it("flags a value that is not a number under a fixed number type, and doesn't run", async () => {
    const { card, onRun, rows } = await openGoal();

    await rows.addButton.click();
    await rows.label(1).fill("quantity");
    await rows.value(1).fill("Milk");
    await rows.type(1).click();

    await expect.poll(() => rows.typeState(1)).toBe("number");
    expect(await rows.problem(1).textContent()).toBe("Not a number.");
    await expect.poll(() => card.runButton.isDisabled()).toBe(true);

    await rows.value(1).fill("3");
    await expect.poll(() => card.runButton.isDisabled()).toBe(false);
    await card.runButton.click();
    expect(onRun).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ values: { quantity: 3 } })
    );
  });

  it("flags a missing or repeated label, and doesn't run", async () => {
    const { card, onRun, rows } = await openGoal();

    await rows.fill({ name: "Milk" });
    await rows.addButton.click();
    await rows.value(2).fill("Eggs");
    await expect.poll(() => rows.problem(2).textContent()).toBe("Add a label.");
    await rows.label(2).fill("name");

    await expect
      .poll(() => rows.problem(2).textContent())
      .toBe("This label is already used.");
    await expect.poll(() => card.runButton.isDisabled()).toBe(true);
    await rows.removeButton(2).click();
    await card.runButton.click();
    expect(onRun).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ values: { name: "Milk" } })
    );
  });

  it("leaves the map out while no row is filled", async () => {
    const { card, onRun, rows } = await openGoal();

    await rows.addButton.click();
    await card.runButton.click();

    expect(onRun).toHaveBeenCalledExactlyOnceWith({
      goal: "Add an item called Milk",
      maxSteps: 5,
    });
  });

  it("adds a row on Enter in the last value, and removes an empty one on Backspace", async () => {
    const { rows } = await openGoal();

    await rows.addButton.click();
    await rows.label(1).press("Enter");
    await rows.value(1).fill("Milk");
    await rows.value(1).press("Enter");
    await expect.poll(() => rows.rows().count()).toBe(2);
    await rows.label(2).press("Backspace");

    await expect.poll(() => rows.rows().count()).toBe(1);
  });

  it("keeps the rows and the JSON editor in step", async () => {
    const { card, rows } = await openGoal();

    await rows.fill({ name: "Milk", count: 2 });
    await card.jsonSwitch.click();
    await expect
      .poll(async () =>
        JSON.parse((await card.jsonEditor.inputValue()) || "{}")
      )
      .toEqual({
        goal: "Add an item called Milk",
        maxSteps: 5,
        values: { name: "Milk", count: 2 },
      });
    await card.jsonEditor.fill(
      '{ "goal": "Add Milk", "maxSteps": 5, "values": { "code": "7", "count": 3 } }'
    );
    await card.formSwitch.click();

    expect(await rows.label(1).inputValue()).toBe("code");
    expect(await rows.value(1).inputValue()).toBe("7");
    // A string that reads as a number comes back fixed to text.
    expect(await rows.typeState(1)).toBe("text");
    expect(await rows.typeState(2)).toBe("auto · number");
  });

  it("names a map value of the wrong type by its label", async () => {
    const { card } = await openGoal();

    await card.jsonSwitch.click();
    await card.jsonEditor.fill(
      '{ "goal": "Sign up", "maxSteps": 5, "values": { "zip": true } }'
    );

    await expect
      .poll(() => card.schemaErrors.allTextContents())
      .toEqual(["values.zip: must be a string or a number"]);
  });
});

describe("a single-element tool", () => {
  const fillRef: RunnableTool = {
    name: "fill",
    action: "fill",
    description: "Fill a real editable element ref with text.",
    present: true,
    available: true,
    refField: "ref",
    argumentsSchema: {
      type: "object",
      properties: { ref: { type: "string" }, value: { type: "string" } },
      required: ["ref", "value"],
    },
  };

  it("runs with the ref chosen and the value typed in", async () => {
    const { card, onRun } = renderCard({
      tool: fillRef,
      head: false,
      refSource: {
        roots: buildStructureTree(
          forest(node({ ref: "e12", role: "textbox", name: "New item" })),
          new Map()
        ).roots,
      },
    });

    await card.run({ ref: "e12", value: "Milk" });

    expect(onRun).toHaveBeenCalledExactlyOnceWith({
      ref: "e12",
      value: "Milk",
    });
  });

  it("runs on the view's ref, asking only for the rest", async () => {
    const { card, onRun } = renderCard({
      tool: fillRef,
      structuralRef: "e12",
      refSource: {
        roots: buildStructureTree(
          forest(node({ ref: "e12", role: "textbox", name: "New item" })),
          new Map()
        ).roots,
      },
    });

    await card.runButton.click();
    expect(await card.refField().value()).toBe('e12 textbox "New item"');
    expect(onRun).not.toHaveBeenCalled();
    await card.run({ value: "Milk" });

    expect(onRun).toHaveBeenCalledExactlyOnceWith({
      ref: "e12",
      value: "Milk",
    });
  });

  it("runs at once on the view's ref when nothing else is needed", async () => {
    const click: RunnableTool = {
      name: "click",
      action: "click",
      description: "Click a real element ref.",
      present: true,
      available: true,
      refField: "ref",
      argumentsSchema: {
        type: "object",
        properties: { ref: { type: "string" } },
        required: ["ref"],
      },
    };
    const { card, onRun } = renderCard({ tool: click, structuralRef: "e4" });

    await card.runButton.click();

    expect(onRun).toHaveBeenCalledExactlyOnceWith({ ref: "e4" });
  });
});

describe("a collection action", () => {
  it("runs on the item picked", async () => {
    const { card, onRun } = renderCard({ tool: rename, items: [milk, eggs] });

    await card.run({ text: "Oat milk" }, { item: "Eggs" });

    expect(onRun).toHaveBeenCalledExactlyOnceWith(
      { ref: "e6", args: { text: "Oat milk" } },
      eggs
    );
  });

  it("runs on the view's item without a picker", async () => {
    const { card, onRun } = renderCard({
      tool: rename,
      item: milk,
      items: [milk, eggs],
    });

    await card.run({ text: "Oat milk" });

    expect(await card.items.count()).toBe(0);
    expect(onRun).toHaveBeenCalledExactlyOnceWith(
      { ref: "e3", args: { text: "Oat milk" } },
      milk
    );
  });
});

describe("the last result", () => {
  it("shows a success's duration and Interactions, its child runs' too, leaving its result to Runs", async () => {
    const { card } = renderCard({
      tool: addItem,
      runs: [
        aRun({
          durationMs: 320,
          result: '{ "added": "Milk" }',
          interactions: [anInteraction()],
          children: [aChildRun({ interactions: [anInteraction()] })],
        }),
      ],
    });

    await expect
      .poll(() => card.lastResult.textContent())
      .toContain("Succeeded · 320 ms · 2 interactions");
    expect(await card.lastResult.getByRole("button").count()).toBe(1);
  });

  it("shows a failure's duration and error", async () => {
    const { card } = renderCard({
      tool: addItem,
      runs: [
        aRun({
          status: "failed",
          durationMs: 1004,
          error: "Timeout 1000ms exceeded.",
        }),
      ],
    });

    await expect
      .poll(() => card.lastResult.textContent())
      .toContain("Failed · 1004 ms");
    expect(await card.lastResult.textContent()).toContain(
      "Timeout 1000ms exceeded."
    );
  });

  it("links to the last successful run in Runs", async () => {
    const { card, onShowRun } = renderCard({
      tool: addItem,
      runs: [
        aRun({ id: "3", status: "failed", error: "No." }),
        aRun({ id: "2" }),
        aRun({ id: "1" }),
      ],
    });

    await card.lastSuccessLink.click();

    expect(await card.lastSuccessLink.textContent()).toBe("Last success ›");
    expect(onShowRun).toHaveBeenCalledExactlyOnceWith("2");
  });

  it("is the last run on the item picked", async () => {
    const { card } = renderCard({
      tool: rename,
      items: [milk, eggs],
      runs: [
        aRun({
          toolName: rename.name,
          item: eggs,
          status: "failed",
          error: "Gone.",
        }),
        aRun({ toolName: rename.name, item: milk }),
      ],
    });

    await card.openArguments();
    await expect
      .poll(() => card.lastResult.textContent())
      .toContain("Succeeded");
    await card.pickItem("Eggs");
    await expect.poll(() => card.lastResult.textContent()).toContain("Failed");
  });
});
