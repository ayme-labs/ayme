import { afterEach, describe, expect, it, vi } from "vitest";
import { createPage } from "@ayme-dev/playwright-lite";

import type { RunnableTool } from "../adapter/runnableTools";
import { forest, node } from "../adapter/projected.testSupport";
import { buildStructureTree } from "../adapter/structure";
import type { CollectionItem, Run } from "../adapter/useRuns";
import { renderPart } from "../testing/renderPart";
import { RunCard as RunCardPart } from "../testing";
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
  available: true,
  argumentsSchema: { type: "object", properties: {} },
};

const addItem: RunnableTool = {
  name: "ListPage.addItem",
  action: "addItem",
  description: "Add an item to the list.",
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
  available: true,
  argumentsSchema: {
    type: "object",
    properties: { text: { type: "string" } },
    required: ["text"],
  },
  collection: "ListPage.items[]",
};

const milk: CollectionItem = {
  path: "ListPage.items[0]",
  name: "[0]",
  pathBelowPage: "items[0]",
  ref: "e3",
  label: "Milk",
};
const eggs: CollectionItem = {
  path: "ListPage.items[1]",
  name: "[1]",
  pathBelowPage: "items[1]",
  ref: "e6",
  label: "Eggs",
};

function aRun(id: number, extra: Partial<Run>): Run {
  return {
    id,
    toolName: "ListPage.addItem",
    className: "ListPage",
    objectPath: "ListPage",
    arguments: { text: "Milk" },
    status: "succeeded",
    startedAt: 0,
    durationMs: 320,
    steps: [],
    ...extra,
  };
}

function renderCard(props: Partial<RunCardProps> & Pick<RunCardProps, "tool">) {
  const onRun = vi.fn();
  const onShowRun = vi.fn();
  unmounts.push(
    renderPart(
      <RunCard
        available
        runs={[]}
        onRun={onRun}
        onShowRun={onShowRun}
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
  });

  it("opens the typed form first when an argument is required", async () => {
    const { card, onRun } = renderCard({ tool: addItem });

    await card.runButton.click();

    await expect.poll(() => card.field("text").count()).toBe(1);
    expect(onRun).not.toHaveBeenCalled();

    await card.field("text").fill("Milk");
    await card.runButton.click();

    expect(onRun).toHaveBeenCalledExactlyOnceWith({ text: "Milk" });
  });

  it("is not there on an action the page doesn't publish", async () => {
    const { card } = renderCard({ tool: clearList, available: false });

    await expect.poll(() => card.root.count()).toBe(1);
    expect(await card.runButton.count()).toBe(0);
  });

  it("sits at the foot of an open form on a card without a head", async () => {
    const { card, onRun } = renderCard({ tool: addItem, head: false });

    await card.field("text").fill("Milk");
    await card.runButton.click();

    expect(await card.argumentsToggle.count()).toBe(0);
    expect(onRun).toHaveBeenCalledExactlyOnceWith({ text: "Milk" });
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

  it("reports invalid JSON and doesn't run", async () => {
    const { card, onRun } = renderCard({ tool: addItem });

    await card.fillJson('{ "text": ');
    await card.runButton.click();

    await expect
      .poll(() => card.jsonError.textContent())
      .toMatch(/^Invalid JSON: /);
    expect(onRun).not.toHaveBeenCalled();
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

describe("a single-element tool", () => {
  const fillRef: RunnableTool = {
    name: "fill",
    action: "fill",
    description: "Fill a real editable element ref with text.",
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
  it("shows a success's duration and steps, leaving its result to Runs", async () => {
    const step = {
      operation: "click",
      locator: "getByRole('button')",
    } as const;
    const { card } = renderCard({
      tool: addItem,
      runs: [aRun(1, { result: '{ "added": "Milk" }', steps: [step, step] })],
    });

    await expect
      .poll(() => card.lastResult.textContent())
      .toContain("Succeeded · 320 ms · 2 steps");
    expect(await card.lastResult.getByRole("button").count()).toBe(1);
  });

  it("shows a failure's duration and error", async () => {
    const { card } = renderCard({
      tool: addItem,
      runs: [
        aRun(2, {
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
        aRun(3, { status: "failed", error: "No." }),
        aRun(2, {}),
        aRun(1, {}),
      ],
    });

    await card.lastSuccessLink.click();

    expect(await card.lastSuccessLink.textContent()).toBe("Last success ›");
    expect(onShowRun).toHaveBeenCalledExactlyOnceWith(2);
  });

  it("is the last run on the item picked", async () => {
    const { card } = renderCard({
      tool: rename,
      items: [milk, eggs],
      runs: [
        aRun(2, {
          toolName: rename.name,
          item: eggs,
          status: "failed",
          error: "Gone.",
        }),
        aRun(1, { toolName: rename.name, item: milk }),
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
