import { useState } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { createPage } from "@ayme-dev/playwright-lite";

import type { StructureTree } from "../adapter/structure";
import { DetailPane } from "../frame/InspectorBody";
import type { LensId } from "../frame/lens";
import { Navigator } from "../frame/Navigator";
import type { RenderRun } from "../frame/runSlot";
import { pageSelection, type Selection } from "../frame/selection";
import { renderPart } from "../renderPart";
import {
  DetailPane as DetailPanePart,
  Navigator as NavigatorPart,
  StructureLens,
} from "../testing";
import { structureLens, type RefHighlight } from "./structureLens";

// Component tests: the Structure lens in the navigator and the detail pane,
// with a fixture structure and callbacks, driven through the Inspector's
// page objects on playwright-lite. The SUT is Virtual: the evidence covers
// what the lens shows and which callbacks it calls, not the runtime.

const page = createPage();
const navigator = new NavigatorPart(
  page.getByRole("navigation", { name: "Navigator" })
);
const lens = new StructureLens(navigator.root);
const { node } = new DetailPanePart(
  page.getByRole("region", { name: "Selected" })
);
const unmounts: (() => void)[] = [];

afterEach(() => {
  for (const unmount of unmounts.splice(0)) unmount();
});

// The fixture list page's structure, as the adapter hands it over.
const groceries: StructureTree = {
  refCount: 6,
  roots: [
    {
      ref: "e1",
      role: "main",
      name: "",
      children: [
        { ref: "e2", role: "heading", name: "Groceries", children: [] },
        {
          ref: "e3",
          role: "textbox",
          name: "New item",
          member: "ListPage.newItemInput",
          owner: "ListPage",
          children: [],
        },
        {
          ref: "e4",
          role: "button",
          name: "Add item",
          member: "ListPage.addItemButton",
          owner: "ListPage",
          children: [],
        },
        {
          ref: "e5",
          role: "list",
          name: "Items",
          children: [
            {
              ref: "e6",
              role: "listitem",
              name: "",
              member: "ListPage.items[0]",
              owner: "ListPage.items[0]",
              children: [{ role: "text", name: "Milk", children: [] }],
            },
          ],
        },
      ],
    },
  ],
};

const refTools = [
  { name: "click_page_state_ref" },
  { name: "fill_page_state_ref" },
];

function renderLens({
  onSelect = vi.fn(),
  highlight = fakeHighlight(),
  renderRun = () => null,
  initialSelection = pageSelection,
}: {
  onSelect?: (selection: Selection) => void;
  highlight?: RefHighlight;
  renderRun?: RenderRun;
  initialSelection?: Selection;
} = {}) {
  function Harness() {
    const [selection, setSelection] = useState(initialSelection);
    const [activeLens, setActiveLens] = useState<LensId>("structure");
    const structure = structureLens({
      structure: groceries,
      capture: { capturedAt: "10:42:30", loading: false },
      onRefresh: () => {},
      selection,
      onSelect: (next) => {
        setSelection(next);
        onSelect(next);
      },
      highlight,
      refTools,
      renderRun,
    });
    return (
      <div className="flex h-[600px]">
        <Navigator
          lenses={[structure]}
          activeLens={activeLens}
          onLensChange={setActiveLens}
          onSelect={setSelection}
          onPreviewRef={highlight.previewRef}
          onPreviewEnd={highlight.clearPreview}
        />
        <DetailPane>{structure.detail(selection)}</DetailPane>
      </div>
    );
  }
  unmounts.push(renderPart(<Harness />));
}

function fakeHighlight(): RefHighlight {
  return {
    previewRef: vi.fn(),
    clearPreview: vi.fn(),
    togglePinnedRef: vi.fn(),
  };
}

it("shows the page structure as a tree, each node tagged with its member", async () => {
  renderLens();

  await expect.poll(() => lens.rows.count()).toBe(7);
  expect(await lens.node("e4").getAttribute("aria-level")).toBe("2");
  expect(await lens.memberOf("e4")).toBe("ListPage.addItemButton");
  expect(await lens.memberOf("e6")).toBe("ListPage.items[0]");
  expect(await lens.memberOf("e2")).toBeNull();
  expect(await lens.rows.last().textContent()).toBe('"Milk"');
});

it("highlights a node on the page while it's hovered", async () => {
  const highlight = fakeHighlight();
  renderLens({ highlight });

  await lens.node("e4").hover();
  await expect.poll(() => highlight.previewRef).toHaveBeenCalledWith("e4");

  await lens.node("e2").hover();
  expect(highlight.clearPreview).toHaveBeenCalled();
});

it("selects a picked node and pins its highlight", async () => {
  const onSelect = vi.fn();
  const highlight = fakeHighlight();
  renderLens({ onSelect, highlight });

  await lens.pick("e4");

  expect(onSelect).toHaveBeenCalledExactlyOnceWith({ kind: "node", ref: "e4" });
  expect(highlight.togglePinnedRef).toHaveBeenCalledExactlyOnceWith("e4");
  await expect
    .poll(() => lens.node("e4").getAttribute("aria-selected"))
    .toBe("true");
  await expect
    .poll(() => node.title.textContent())
    .toBe('e4 button "Add item"');
});

it("links a node's detail to the Page Object that owns it", async () => {
  const onSelect = vi.fn();
  renderLens({ onSelect, initialSelection: { kind: "node", ref: "e6" } });

  await expect
    .poll(() => node.memberLink.textContent())
    .toBe("ListPage.items[0]");
  await node.openOwner();

  expect(onSelect).toHaveBeenCalledExactlyOnceWith({
    kind: "object",
    path: "ListPage.items[0]",
  });
});

it("says a node without a member can still be acted on by ref", async () => {
  renderLens({ initialSelection: { kind: "node", ref: "e2" } });

  await expect
    .poll(() => node.root.textContent())
    .toContain("No page object member maps to this node.");
  expect(await node.memberLink.count()).toBe(0);
});

it("runs a node's Ref tools on its ref through the run slot", async () => {
  const renderRun: RenderRun = ({ toolName, ref }) => (
    <button type="button">
      {toolName} on {ref}
    </button>
  );
  renderLens({ renderRun, initialSelection: { kind: "node", ref: "e3" } });

  await expect
    .poll(() => node.tools.getByRole("button").allTextContents())
    .toEqual(["click_page_state_ref on e3", "fill_page_state_ref on e3"]);
});

it("finds refs in search and shows the one picked", async () => {
  const highlight = fakeHighlight();
  renderLens({ highlight });

  await navigator.search("add item");
  const result = navigator.result('e4 button "Add item"');
  await expect
    .poll(() => result.textContent())
    .toContain("ListPage.addItemButton");
  await result.hover();
  await expect.poll(() => highlight.previewRef).toHaveBeenCalledWith("e4");
  await result.click();

  await expect
    .poll(() => node.title.textContent())
    .toBe('e4 button "Add item"');
});

it("counts the refs in the legend", async () => {
  renderLens();

  await expect.poll(() => navigator.legend.textContent()).toBe("6 refs");
});
