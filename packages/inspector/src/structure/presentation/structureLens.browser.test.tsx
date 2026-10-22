import { useState } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { createPage } from "@ayme-dev/playwright-lite";

import type { StructureTree } from "../domain/structure";
import { shownUnfolded } from "../domain/treeRows";
import { DetailPane } from "../../panel";
import {
  type Lens,
  type LensId,
  Navigator,
  type OnHover,
  pageSelection,
  type RenderRun,
  type Selection,
} from "../../navigation";
import { renderPart } from "../../testing/renderPart";
import {
  DetailPane as DetailPanePart,
  Navigator as NavigatorPart,
  StructureLens,
} from "../../testing";
import { structureLens } from "./structureLens";

// Component tests: the Structure lens in the navigator and the detail pane,
// with a fixture structure and callbacks, driven through the Inspector's
// page objects on playwright-lite. The SUT is Virtual: the evidence covers
// what the lens shows and which callbacks it calls, not the runtime.

const page = createPage();
const navigator = new NavigatorPart(
  page.getByRole("navigation", { name: "Navigator" })
);
const lens = new StructureLens(navigator.root);
const detailPane = page.getByRole("region", { name: "Selected" });
const { node } = new DetailPanePart(detailPane);
const unmounts: (() => void)[] = [];

afterEach(() => {
  for (const unmount of unmounts.splice(0)) unmount();
});

// The fixture list page's structure, as the app hands it over.
const groceries: StructureTree = {
  refCount: 6,
  roots: [
    {
      ref: "e1",
      role: "main",
      name: "",
      members: [],
      children: [
        {
          ref: "e2",
          role: "heading",
          name: "Groceries",
          state: { level: 1 },
          members: [],
          children: [],
        },
        {
          ref: "e3",
          role: "textbox",
          name: "New item",
          members: ["ListPage.newItemInput"],
          member: "ListPage.newItemInput",
          tag: ".newItemInput",
          memberLinks: [
            { member: "ListPage.newItemInput", owner: { object: "ListPage" } },
          ],
          owner: "ListPage",
          children: [],
        },
        {
          ref: "e4",
          role: "button",
          name: "Add item",
          members: ["ListPage.addItemButton"],
          member: "ListPage.addItemButton",
          tag: ".addItemButton",
          memberLinks: [
            { member: "ListPage.addItemButton", owner: { object: "ListPage" } },
          ],
          owner: "ListPage",
          children: [],
        },
        {
          ref: "e5",
          role: "list",
          name: "Items",
          members: [],
          pageStateLines: ['- e5 list "Items" [cursor=pointer]:'],
          childCount: 1,
          children: [
            {
              ref: "e6",
              role: "listitem",
              name: "",
              members: ["ListPage.items[0]"],
              member: "ListPage.items[0]",
              tag: "items[0] · ListItem",
              memberLinks: [
                {
                  member: "ListPage.items[0]",
                  owner: { object: "ListPage.items[0]" },
                },
                { member: "ListItem", owner: { model: "ListItem" } },
              ],
              owner: "ListPage.items[0]",
              children: [
                { role: "text", name: "Milk", members: [], children: [] },
              ],
            },
          ],
        },
      ],
    },
  ],
};

// Stands in for the Model lens: it shows the fixture page's Page
// Object instances and models, and nothing else.
const pageObjectsLens: Lens = {
  id: "model",
  label: "Model",
  tree: null,
  searchEntries: [],
  legend: {},
  detail: (selection) => {
    const shown =
      selection.kind === "object"
        ? ["ListPage", "ListPage.items[0]"].includes(selection.path)
        : selection.kind === "model" &&
          ["ListPage", "ListItem"].includes(selection.className);
    return shown ? <p>Showing {JSON.stringify(selection)}</p> : undefined;
  },
};
const nothingToShow = "Nothing to show for this selection.";

// Which refs each single-element tool can take: fill only the text field.
const refSchema = {
  type: "object",
  properties: { ref: { type: "string" } },
  required: ["ref"],
};
const elementTools = [
  {
    name: "click",
    inputSchema: refSchema,
    refs: ["e3", "e4", "e6"],
  },
  { name: "fill", inputSchema: refSchema, refs: ["e3"] },
];

function renderLens({
  structure: tree = groceries,
  onSelect = vi.fn(),
  onHover = vi.fn(),
  renderRun = () => null,
  initialSelection = pageSelection,
}: {
  structure?: StructureTree;
  onSelect?: (selection: Selection) => void;
  onHover?: OnHover;
  renderRun?: RenderRun;
  initialSelection?: Selection;
} = {}) {
  function Harness() {
    const [selection, setSelection] = useState(initialSelection);
    const [activeLens, setActiveLens] = useState<LensId>("structure");
    const [unfoldedChains, setUnfoldedChains] = useState<ReadonlySet<string>>(
      new Set()
    );
    // As the app does, the chains shown around the old selection are kept.
    const select = (next: Selection) => {
      setUnfoldedChains(
        shownUnfolded(
          tree.roots,
          unfoldedChains,
          selection.kind === "node" ? selection.ref : undefined
        )
      );
      setSelection(next);
    };
    const structure = structureLens({
      structure: tree,
      unfoldedChains,
      onUnfoldedChainsChange: setUnfoldedChains,
      capture: { loading: false },
      selection,
      onSelect: (next) => {
        select(next);
        onSelect(next);
      },
      onHover,
      elementTools,
      renderRun,
    });
    return (
      <div className="flex h-[600px]">
        <Navigator
          lenses={[structure]}
          activeLens={activeLens}
          onLensChange={setActiveLens}
          onSelect={select}
          onHover={onHover}
        />
        <DetailPane>
          {[structure, pageObjectsLens]
            .map((lens) => lens.detail(selection))
            .find((view) => view !== undefined) ?? <p>{nothingToShow}</p>}
        </DetailPane>
      </div>
    );
  }
  unmounts.push(renderPart(<Harness />));
}

it("shows the page structure as a tree, each node tagged with its member", async () => {
  renderLens();

  await expect.poll(() => lens.rows.count()).toBe(7);
  expect(await lens.node("e4").getAttribute("aria-level")).toBe("2");
  expect(await lens.memberOf("e4")).toBe("ListPage.addItemButton");
  expect(await lens.memberOf("e6")).toBe("ListPage.items[0]");
  expect(await lens.memberOf("e2")).toBeNull();
  expect(await lens.node("e2").textContent()).toBe('e2heading"Groceries"');
  expect(await lens.rows.last().textContent()).toBe('"Milk"');
});

it("highlights a node on the page while it's hovered", async () => {
  const onHover = vi.fn();
  renderLens({ onHover });

  await lens.node("e4").hover();
  await expect.poll(() => onHover).toHaveBeenLastCalledWith({ ref: "e4" });

  await navigator.searchBox.hover();
  await expect.poll(() => onHover).toHaveBeenLastCalledWith(undefined);
});

it("selects a picked node and shows it", async () => {
  const onSelect = vi.fn();
  renderLens({ onSelect });

  await lens.pick("e4");

  expect(onSelect).toHaveBeenCalledExactlyOnceWith({ kind: "node", ref: "e4" });
  await expect
    .poll(() => lens.node("e4").getAttribute("aria-selected"))
    .toBe("true");
  await expect
    .poll(() => node.title.textContent())
    .toBe('e4 button "Add item"');
});

it("lists every member that locates a node, its tag first", async () => {
  renderLens({ initialSelection: { kind: "node", ref: "e6" } });

  await expect
    .poll(() => node.memberLinks.allTextContents())
    .toEqual(["ListPage.items[0]", "ListItem"]);
});

it("links each member to the Page Object that owns it", async () => {
  const onSelect = vi.fn();
  renderLens({ onSelect, initialSelection: { kind: "node", ref: "e3" } });

  await node.openOwnerOf("ListPage.newItemInput");

  expect(onSelect).toHaveBeenCalledExactlyOnceWith({
    kind: "object",
    path: "ListPage",
  });
});

it("links every member to something the panel can show", async () => {
  renderLens();

  for (const ref of ["e3", "e4", "e6"]) {
    await lens.pick(ref);
    await expect.poll(() => node.memberLinks.count()).toBeGreaterThan(0);
    const count = await node.memberLinks.count();
    for (let index = 0; index < count; index += 1) {
      await lens.pick(ref);
      await node.memberLinks.nth(index).click();

      await expect.poll(() => detailPane.textContent()).toMatch(/^Showing /);
    }
  }
});

it("says a node without a member can still be acted on by ref", async () => {
  renderLens({ initialSelection: { kind: "node", ref: "e2" } });

  await expect
    .poll(() => node.root.textContent())
    .toContain("No page object member maps to this node.");
  expect(await node.memberLinks.count()).toBe(0);
});

it("runs the single-element tools that can take a node's ref through the run slot", async () => {
  const renderRun: RenderRun = ({ toolName, ref }) => (
    <button type="button">
      {toolName} on {ref}
    </button>
  );
  renderLens({ renderRun, initialSelection: { kind: "node", ref: "e3" } });

  await expect
    .poll(() => node.tools.getByRole("button").allTextContents())
    .toEqual(["click on e3", "fill on e3"]);
});

it("offers a node only the single-element tools that can take its ref", async () => {
  const renderRun: RenderRun = ({ toolName }) => (
    <button type="button">{toolName}</button>
  );
  renderLens({ renderRun, initialSelection: { kind: "node", ref: "e4" } });

  await expect
    .poll(() => node.tools.getByRole("button").allTextContents())
    .toEqual(["click"]);
  expect(await node.tool("fill").count()).toBe(0);
});

it("offers no tools on a node no single-element tool can take", async () => {
  renderLens({ initialSelection: { kind: "node", ref: "e2" } });

  await expect
    .poll(() => node.title.textContent())
    .toBe('e2 heading "Groceries"');
  expect(await node.tools.count()).toBe(0);
});

it("shows what the model sees of a node: its line with its states, its children only as a count", async () => {
  renderLens({ initialSelection: { kind: "node", ref: "e5" } });

  await node.modelSees.open();

  expect(await node.modelSees.pageState.textContent()).toBe(
    '- e5 list "Items" [cursor=pointer]:'
  );
  expect(await node.modelSees.childCount.textContent()).toBe("1 child");
});

it("shows the schemas of the single-element tools a node offers in what the model sees", async () => {
  renderLens({ initialSelection: { kind: "node", ref: "e4" } });

  await node.modelSees.open();

  expect(await node.modelSees.schemaValue("click")).toEqual(refSchema);
  expect(await node.modelSees.schema("fill").count()).toBe(0);
});

it("finds refs in search and shows the one picked", async () => {
  const onHover = vi.fn();
  renderLens({ onHover });

  await navigator.search("add item");
  const result = navigator.result('e4 button "Add item"');
  await expect
    .poll(() => result.textContent())
    .toContain("ListPage.addItemButton");
  await result.hover();
  await expect.poll(() => onHover).toHaveBeenLastCalledWith({ ref: "e4" });
  await result.click();

  await expect
    .poll(() => node.title.textContent())
    .toBe('e4 button "Add item"');
});

it("counts the refs in the legend", async () => {
  renderLens();

  await expect.poll(() => navigator.legend.textContent()).toBe("6 refs");
});

// A toolbar nested in wrappers, as component libraries render it:
// e10 › e11 › e12 › e13 hold e14 and e15.
const wrapped: StructureTree = {
  refCount: 6,
  roots: [
    {
      ref: "e10",
      role: "generic",
      name: "",
      members: [],
      children: [
        {
          ref: "e11",
          role: "generic",
          name: "",
          members: [],
          children: [
            {
              ref: "e12",
              role: "generic",
              name: "",
              members: [],
              children: [
                {
                  ref: "e13",
                  role: "generic",
                  name: "",
                  members: [],
                  children: [
                    {
                      ref: "e14",
                      role: "button",
                      name: "Save",
                      members: [],
                      children: [],
                    },
                    {
                      ref: "e15",
                      role: "button",
                      name: "Cancel",
                      members: [],
                      children: [],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
  ],
};

it("folds a chain of wrappers into one row, led by its outermost wrapper", async () => {
  renderLens({ structure: wrapped });

  await expect.poll(() => lens.rows.count()).toBe(3);
  expect(await lens.node("e13").textContent()).toBe("e102 more›e13generic");
  expect(await lens.node("e13").getAttribute("aria-expanded")).toBeNull();
  expect(
    await lens
      .node("e13")
      .getByRole("button", { name: "Unfold wrappers" })
      .getAttribute("aria-expanded")
  ).toBe("false");
  expect(await lens.node("e14").getAttribute("aria-level")).toBe("2");
  expect(await lens.node("e11").count()).toBe(0);
});

it("picks the outermost wrapper by its ref, and the row's node by the rest of the row", async () => {
  const onSelect = vi.fn();
  renderLens({ structure: wrapped, onSelect });

  await lens.pickWrapper("e10");
  expect(onSelect).toHaveBeenLastCalledWith({ kind: "node", ref: "e10" });
  await expect.poll(() => node.title.textContent()).toBe("e10 generic");

  await lens.pick("e13");
  expect(onSelect).toHaveBeenLastCalledWith({ kind: "node", ref: "e13" });
});

it("unfolds a chain into a row for each wrapper, and folds it back", async () => {
  renderLens({ structure: wrapped });

  await lens.toggleWrappers("e13");

  await expect.poll(() => lens.rows.count()).toBe(6);
  expect(await lens.node("e12").getAttribute("aria-level")).toBe("3");
  expect(await lens.node("e14").getAttribute("aria-level")).toBe("5");

  await lens.toggleWrappers("e10");

  await expect.poll(() => lens.rows.count()).toBe(3);
});

it("keeps focus on the toggle as it moves between a chain's rows", async () => {
  renderLens({ structure: wrapped });
  // The panel renders in a shadow root, which holds its focused element.
  const active = () =>
    document.activeElement?.shadowRoot?.activeElement ?? null;
  const focused = () => active()?.getAttribute("aria-label");

  await lens
    .node("e13")
    .getByRole("button", { name: "Unfold wrappers" })
    .press("Enter");

  await expect.poll(focused).toBe("Fold wrappers");
  expect(
    active()?.closest('[role="treeitem"]')?.getAttribute("aria-label")
  ).toBe("e10 generic");

  await lens
    .node("e10")
    .getByRole("button", { name: "Fold wrappers" })
    .press("Enter");

  await expect.poll(focused).toBe("Unfold wrappers");
});

it("unfolds the chain of a hidden wrapper picked in search, and keeps it unfolded", async () => {
  renderLens({ structure: wrapped });

  await navigator.search("e12");
  await navigator.result("e12 generic").click();

  await expect
    .poll(() => lens.node("e12").getAttribute("aria-selected"))
    .toBe("true");
  expect(await lens.rows.count()).toBe(6);

  await lens.pick("e14");

  await expect
    .poll(() => lens.node("e14").getAttribute("aria-selected"))
    .toBe("true");
  expect(await lens.rows.count()).toBe(6);
});

it("keeps the outermost wrapper selected when folding hides the selected one", async () => {
  const onSelect = vi.fn();
  renderLens({
    structure: wrapped,
    onSelect,
    initialSelection: { kind: "node", ref: "e12" },
  });

  await lens.toggleWrappers("e10");

  expect(onSelect).toHaveBeenLastCalledWith({ kind: "node", ref: "e10" });
  await expect.poll(() => lens.rows.count()).toBe(3);
});

it("scrolls sideways only when the deepest row has no room for its ref and role", async () => {
  // e20 › e21 › … › e59, unfolded: 40 levels, deeper than the panel is wide.
  let deep: StructureTree["roots"][number] = {
    ref: "e60",
    role: "button",
    name: "Save",
    members: [],
    children: [],
  };
  for (let index = 59; index >= 20; index -= 1)
    deep = {
      ref: `e${index}`,
      role: "generic",
      name: "",
      members: [],
      children: [deep, ...(index === 59 ? [{ ...deep, ref: "e61" }] : [])],
    };
  // Whether the navigator's scroll area is wider than the panel.
  const sideways = async () =>
    (await lens.tree.elementHandle())!.evaluate((tree) => {
      const scroller = tree.closest(".overflow-auto")!;
      return scroller.scrollWidth > scroller.clientWidth;
    });
  renderLens({ structure: wrapped });
  await expect.poll(() => lens.rows.count()).toBe(3);
  expect(await sideways()).toBe(false);
  unmounts.pop()?.();

  renderLens({ structure: { refCount: 42, roots: [deep] } });
  await lens.toggleWrappers("e59");

  await expect.poll(sideways).toBe(true);
});
