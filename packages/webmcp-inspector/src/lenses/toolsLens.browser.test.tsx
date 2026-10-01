import { useState } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { createPage } from "@ayme-dev/playwright-lite";

import { DetailPane as DetailPaneFrame } from "../frame/InspectorBody";
import { Navigator as NavigatorFrame } from "../frame/Navigator";
import type { RenderRun } from "../frame/runSlot";
import { pageSelection, type Selection } from "../frame/selection";
import { renderPart } from "../renderPart";
import { DetailPane, Navigator } from "../testing";
import type { LiveTool } from "./toolGroups";
import { toolsLens } from "./toolsLens";

// Component tests: the Tools lens in the navigator and a tool's page in the
// detail pane, with fixture tools, driven through their page objects.

const page = createPage();
const navigator = new Navigator(
  page.getByRole("navigation", { name: "Navigator" })
);
const detail = new DetailPane(page.getByRole("region", { name: "Selected" }));
const unmounts: (() => void)[] = [];

afterEach(() => {
  for (const unmount of unmounts.splice(0)) unmount();
});

const addItem: LiveTool = {
  name: "ListPage.addItem",
  description: "Add an item to the list.",
  inputSchema: {
    type: "object",
    properties: { text: { type: "string" } },
    required: ["text"],
  },
  group: "pageObject",
  pomClassName: "ListPage",
};
const click: LiveTool = {
  name: "click_page_state_ref",
  description: "Click the element a Structural Ref points to.",
  inputSchema: {
    type: "object",
    properties: { ref: { type: "string" } },
    required: ["ref"],
  },
  group: "ref",
};
const pageContext: LiveTool = {
  name: "get_page_context",
  description: "Return the page state and the POM definitions.",
  inputSchema: { type: "object", properties: {} },
  group: "agent",
};
const listPageDefinition =
  "POM ListPage\n  newItemInput\n\n  // Add an item to the list.\n  addItem(text: string)";
/** The runtime's definitions: only ListPage is known. */
const definitionText = (className: string) =>
  className === "ListPage" ? listPageDefinition : "";

/** A run slot that shows which tool it was asked to run. */
const runSlot: RenderRun = ({ toolName }) => (
  <form aria-label={`Run ${toolName}`}>
    <button type="submit">Run</button>
  </form>
);

function renderTools({
  tools = [pageContext, click, addItem],
  onSelect = vi.fn(),
}: {
  tools?: LiveTool[];
  onSelect?: (selection: Selection) => void;
} = {}) {
  function Harness() {
    const [selection, setSelection] = useState<Selection>(pageSelection);
    const select = (next: Selection) => {
      onSelect(next);
      setSelection(next);
    };
    const lens = toolsLens({
      tools,
      definitionText,
      selection,
      onSelect: select,
      renderRun: runSlot,
    });
    return (
      <div className="flex h-[600px]">
        <NavigatorFrame
          lenses={[lens]}
          activeLens="tools"
          onLensChange={() => {}}
          onSelect={select}
        />
        <DetailPaneFrame>{lens.detail(selection)}</DetailPaneFrame>
      </div>
    );
  }
  unmounts.push(renderPart(<Harness />));
}

it("lists the live tools as Page object, Ref and Agent tools", async () => {
  renderTools();

  await expect
    .poll(() => navigator.tools.listed())
    .toEqual({
      "Page object tools": ["ListPage.addItem"],
      "Ref tools": ["click_page_state_ref"],
      "Agent tools": ["get_page_context"],
    });
});

it("opens a tool's page with its description, then the run slot", async () => {
  const onSelect = vi.fn();
  renderTools({ onSelect });

  await navigator.tools.tool("ListPage.addItem").click();

  expect(onSelect).toHaveBeenCalledExactlyOnceWith({
    kind: "tool",
    name: "ListPage.addItem",
  });
  const { toolPage } = detail;
  await expect
    .poll(() => toolPage.title.textContent())
    .toBe("ListPage.addItem");
  expect(await toolPage.description.textContent()).toBe(
    "Add an item to the list."
  );
  const runSlotForm = toolPage.root.getByRole("form", {
    name: "Run ListPage.addItem",
  });
  const top = async (locator: typeof runSlotForm) =>
    (await locator.boundingBox())?.y ?? Number.NaN;
  expect(await top(toolPage.title)).toBeLessThan(
    await top(toolPage.description)
  );
  expect(await top(toolPage.description)).toBeLessThan(await top(runSlotForm));
  expect(await toolPage.root.getByRole("heading").count()).toBe(1);
});

it("links a Page object tool to its Page Object Model", async () => {
  const onSelect = vi.fn();
  renderTools({ onSelect });
  await navigator.tools.tool("ListPage.addItem").click();

  await detail.toolPage.modelLink.click();

  expect(onSelect).toHaveBeenLastCalledWith({
    kind: "model",
    className: "ListPage",
  });
});

it("shows what the model sees of a Page object tool: its model's definition and its schema", async () => {
  renderTools();
  await navigator.tools.tool("ListPage.addItem").click();
  const { modelSees } = detail.toolPage;

  await modelSees.open();

  await expect
    .poll(() => modelSees.toggle.textContent())
    .toBe("What the model sees · definition and 1 tool schema");
  expect(await modelSees.definitions.textContent()).toBe(listPageDefinition);
  expect(await modelSees.schemaValue("ListPage.addItem")).toEqual(
    addItem.inputSchema
  );
});

it("shows only the schema of a tool without a Page Object Model", async () => {
  renderTools();
  await navigator.tools.tool("click_page_state_ref").click();
  const { modelSees } = detail.toolPage;

  await modelSees.open();

  await expect
    .poll(() => modelSees.toggle.textContent())
    .toBe("What the model sees · 1 tool schema");
  expect(await modelSees.definitions.count()).toBe(0);
  expect(await modelSees.schemaValue("click_page_state_ref")).toEqual(
    click.inputSchema
  );
  expect(await detail.toolPage.modelLink.count()).toBe(0);
});

it("has no page for a tool that is no longer live", () => {
  const lens = toolsLens({
    tools: [click],
    definitionText,
    selection: { kind: "tool", name: "ListPage.addItem" },
    onSelect: () => {},
    renderRun: runSlot,
  });

  // No view: the frame treats the selection as stale and falls back.
  expect(lens.detail({ kind: "tool", name: "ListPage.addItem" })).toBe(
    undefined
  );
});
