import { useState } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { createPage } from "@ayme-dev/playwright-lite";

import type { PageModel, PageObjectNode } from "../domain/pageModel";
import { defaultPreferences, DetailPane } from "../../panel";
import {
  type Lens,
  type LensId,
  Navigator,
  type OnHover,
  type RenderRun,
  type Selection,
} from "../../navigation";
import { renderPart } from "../../testing/renderPart";
import {
  DetailPane as DetailPanePart,
  Navigator as NavigatorPart,
} from "../../testing";
import { modelLens } from "./modelLens";

// Component tests: the Model lens in the navigator and the detail pane, with
// a fixture page model, driven through the Inspector's page objects on
// playwright-lite. The page's hover highlight and the run slot are stand-ins, so the
// evidence covers what the lens shows and which callbacks it calls.

const page = createPage();
const navigator = new NavigatorPart(
  page.getByRole("navigation", { name: "Navigator" })
);
const lens = navigator.model;
const detail = new DetailPanePart(
  page.getByRole("region", { name: "Selected" })
).model;
const unmounts: (() => void)[] = [];

afterEach(() => {
  for (const unmount of unmounts.splice(0)) unmount();
});

const item = (index: number, label: string): PageObjectNode => ({
  path: `TodoPage.items[${index}]`,
  key: `todo:TodoPage.items[${index}]`,
  name: `[${index}]`,
  kind: "item",
  className: "TodoItem",
  live: true,
  members: [
    {
      name: "archiveButton",
      kind: "locator",
      live: true,
      state: "1 match",
      path: `TodoPage.items[${index}].archiveButton`,
    },
  ],
  actions: [
    {
      name: "archive",
      description: `Archive ${label}.`,
      signature: "()",
      toolName: "TodoPage.items.archive",
      live: true,
    },
  ],
  children: [],
});

const items = [item(0, "Water plants"), item(1, "Pay rent")];

const dialog: PageObjectNode = {
  path: "TodoPage.archiveDialog",
  key: "todo:TodoPage.archiveDialog",
  name: "archiveDialog",
  kind: "component",
  className: "ArchiveDialog",
  live: false,
  members: [
    {
      name: "confirmButton",
      kind: "locator",
      live: false,
      state: "absent",
      path: "TodoPage.archiveDialog.confirmButton",
    },
  ],
  actions: [],
  children: [],
};

const todoPage: PageObjectNode = {
  path: "TodoPage",
  key: "todo:TodoPage",
  name: "TodoPage",
  kind: "page",
  className: "TodoPage",
  live: true,
  members: [
    {
      name: "newItemInput",
      kind: "locator",
      live: true,
      state: "1 match",
      path: "TodoPage.newItemInput",
    },
    {
      name: "items",
      kind: "component",
      className: "TodoItem",
      collection: true,
      live: true,
      state: "2 items",
      path: "TodoPage.items",
      objectPath: "TodoPage.items",
    },
    {
      name: "archiveDialog",
      kind: "component",
      className: "ArchiveDialog",
      live: false,
      state: "not on page",
      path: "TodoPage.archiveDialog",
      objectPath: "TodoPage.archiveDialog",
    },
  ],
  actions: [
    {
      name: "addItem",
      description: "Add an item.",
      signature: "(text: string)",
      toolName: "TodoPage.addItem",
      live: true,
    },
  ],
  children: [
    {
      path: "TodoPage.items",
      key: "todo:TodoPage.items",
      name: "items",
      kind: "collection",
      className: "TodoItem",
      live: true,
      itemCount: 2,
      members: [],
      actions: items[0]!.actions,
      children: items,
    },
    dialog,
  ],
};

const pageModel: PageModel = {
  objects: [todoPage],
  models: [
    {
      className: "TodoPage",
      members: [
        {
          name: "newItemInput",
          kind: "locator",
          path: "TodoPage.newItemInput",
        },
        {
          name: "items",
          kind: "component",
          className: "TodoItem",
          collection: true,
          path: "TodoPage.items",
        },
      ],
      actions: [
        {
          name: "addItem",
          signature: "(text: string)",
          toolNames: ["TodoPage.addItem"],
          liveToolNames: ["TodoPage.addItem"],
        },
      ],
      instancePaths: ["TodoPage"],
    },
    {
      className: "TodoItem",
      members: [
        {
          name: "archiveButton",
          kind: "locator",
          path: "TodoItem.archiveButton",
        },
      ],
      actions: [
        {
          name: "archive",
          signature: "()",
          toolNames: ["TodoPage.items.archive"],
          liveToolNames: ["TodoPage.items.archive"],
        },
      ],
      instancePaths: ["TodoPage.items[0]", "TodoPage.items[1]"],
    },
    {
      className: "ArchiveDialog",
      members: [
        {
          name: "confirmButton",
          kind: "locator",
          path: "ArchiveDialog.confirmButton",
        },
      ],
      actions: [
        {
          name: "confirm",
          description: "Confirm the archive.",
          signature: "()",
          toolNames: ["TodoPage.archiveDialog.confirm"],
          liveToolNames: [],
        },
      ],
      instancePaths: [],
    },
  ],
};

// Another lens to switch to, standing in for the Structure lens.
const structureLens: Lens = {
  id: "structure",
  label: "Structure",
  tree: <p>The Structure tree</p>,
  searchEntries: [],
  legend: {},
  detail: () => undefined,
};

function renderLens({
  selection: initial = { kind: "page" },
}: { selection?: Selection } = {}) {
  const onHover = vi.fn<OnHover>();
  const onSelect = vi.fn();
  const renderRun = vi.fn<RenderRun>(({ toolName }) => (
    <button type="button">Run {toolName}</button>
  ));

  function Harness() {
    const [selection, setSelection] = useState(initial);
    const [activeLens, setActiveLens] = useState<LensId>("model");
    const [panes, setPanes] = useState(defaultPreferences.modelPanes);
    const model = modelLens({
      host: "localhost:5173",
      pageModel,
      pageTools: ["snapshot", "goal"],
      selection,
      onSelect: (next) => {
        onSelect(next);
        setSelection(next);
      },
      onHover,
      renderRun,
      panes,
      onPanesChange: setPanes,
    });
    return (
      <div className="flex" style={{ width: 800, height: 600 }}>
        <Navigator
          lenses={[model, structureLens]}
          activeLens={activeLens}
          onLensChange={setActiveLens}
          onSelect={(next) => {
            onSelect(next);
            setSelection(next);
          }}
          onHover={onHover}
        />
        <DetailPane>{model.detail(selection)}</DetailPane>
      </div>
    );
  }
  unmounts.push(renderPart(<Harness />));
  return { onHover, onSelect, renderRun };
}

async function height(locator: typeof lens.root) {
  const box = await locator.boundingBox();
  if (!box) throw new Error("The pane is not visible.");
  return box.height;
}

it("shows the Page Objects on this page as a tree, marking those not on the page", async () => {
  renderLens();

  await expect
    .poll(() => lens.objectTree.getByRole("treeitem").allTextContents())
    .toEqual([
      "/localhost:5173",
      "TodoPagepage",
      "itemsTodoItem[2]",
      "[0]TodoItem",
      "[1]TodoItem",
      "archiveDialogArchiveDialogNot on page",
    ]);
  expect(await lens.isNotOnPage(lens.object("TodoPage.archiveDialog"))).toBe(
    true
  );
  expect(await lens.isNotOnPage(lens.object("TodoPage.items[1]"))).toBe(false);
});

it("lists every Page Object Model the page knows, marking those not on the page", async () => {
  renderLens();

  await expect
    .poll(() => lens.modelNames())
    .toEqual(["TodoPage", "TodoItem", "ArchiveDialog"]);
  expect(await lens.isNotOnPage(lens.model("ArchiveDialog"))).toBe(true);
  expect(await lens.isNotOnPage(lens.model("TodoItem"))).toBe(false);
});

it("counts the live Page Objects and those not on the page in the legend", async () => {
  renderLens();

  await expect
    .poll(() => navigator.legend.textContent())
    .toBe("3 live1 not on page");
});

it("collapses each pane to its header", async () => {
  renderLens();

  await lens.togglePane("On this page");

  await expect.poll(() => lens.objectTree.count()).toBe(0);
  expect(
    await lens.paneToggle("On this page").getAttribute("aria-expanded")
  ).toBe("false");
  expect(await lens.modelList.isVisible()).toBe(true);
  expect(await lens.divider.count()).toBe(0);

  await lens.togglePane("On this page");
  await lens.togglePane("Page object models");

  await expect.poll(() => lens.modelList.count()).toBe(0);
  expect(await lens.objectTree.isVisible()).toBe(true);
});

it("gives one pane more height as the divider is dragged toward the other", async () => {
  renderLens();
  const objects = lens.pane("On this page");
  const models = lens.pane("Page object models");
  await expect.poll(() => lens.divider.isVisible()).toBe(true);
  const before = {
    objects: await height(objects),
    models: await height(models),
  };

  await lens.dragDivider(60);

  await expect.poll(() => height(objects)).toBeGreaterThan(before.objects + 40);
  expect(await height(models)).toBeLessThan(before.models - 40);
});

it("keeps the panes and the divider as they were left when switching lenses", async () => {
  renderLens();
  const objects = lens.pane("On this page");
  await expect.poll(() => lens.divider.isVisible()).toBe(true);
  const before = await height(objects);
  await lens.dragDivider(60);
  await expect.poll(() => height(objects)).toBeGreaterThan(before + 40);
  const dragged = await height(objects);
  await lens.togglePane("Page object models");

  await navigator.showLens("Structure");
  await expect.poll(() => lens.objectTree.count()).toBe(0);
  await navigator.showLens("Model");

  await expect
    .poll(() =>
      lens.paneToggle("Page object models").getAttribute("aria-expanded")
    )
    .toBe("false");
  await lens.togglePane("Page object models");
  await expect.poll(() => height(objects)).toBe(dragged);
});

it("highlights an object while it is hovered, and selects it when it is picked", async () => {
  const { onHover, onSelect } = renderLens();
  const secondItem = lens.object("TodoPage.items[1]");

  await secondItem.hover();
  await expect
    .poll(() => onHover.mock.lastCall)
    .toEqual([{ path: "TodoPage.items[1]" }]);
  await secondItem.click();

  expect(onSelect).toHaveBeenCalledExactlyOnceWith({
    kind: "object",
    path: "TodoPage.items[1]",
  });
  await expect
    .poll(() => secondItem.getAttribute("aria-selected"))
    .toBe("true");
  await lens.object("Page /").hover();
  expect(onHover.mock.lastCall).toEqual([undefined]);
});

it("doesn't highlight an object that is not on the page", async () => {
  const { onHover } = renderLens();

  await lens.object("TodoPage.archiveDialog").hover();
  await lens.object("TodoPage.items[0]").hover();

  await expect
    .poll(() => onHover.mock.calls)
    .toEqual([[{ path: "TodoPage.items[0]" }]]);
});

it("highlights a member while it is hovered, until the pointer leaves", async () => {
  const { onHover, onSelect } = renderLens({
    selection: { kind: "object", path: "TodoPage" },
  });
  const input = detail.member("newItemInput");

  await input.hover();
  await expect
    .poll(() => onHover.mock.lastCall)
    .toEqual([{ path: "TodoPage.newItemInput" }]);
  await detail.title.hover();

  await expect.poll(() => onHover.mock.lastCall).toEqual([undefined]);
  expect(onSelect).not.toHaveBeenCalled();
});

it("shows an object's members as the page probe found them", async () => {
  renderLens({ selection: { kind: "object", path: "TodoPage" } });

  await expect
    .poll(() => detail.memberDescription("newItemInput"))
    .toBe("locator · 1 match");
  expect(await detail.memberDescription("items")).toBe("TodoItem[] · 2 items");
  expect(await detail.memberDescription("archiveDialog")).toBe(
    "ArchiveDialog · not on page"
  );
});

it("links an object to its Page Object Model", async () => {
  const { onSelect } = renderLens({
    selection: { kind: "object", path: "TodoPage.items[0]" },
  });

  await detail.modelLink.click();

  expect(onSelect).toHaveBeenCalledWith({
    kind: "model",
    className: "TodoItem",
  });
  await expect.poll(() => detail.title.textContent()).toBe("TodoItem");
});

it("runs the page-wide tools from the page's detail through the run slot", async () => {
  const { renderRun } = renderLens();

  await expect
    .poll(() => detail.section("Tools").textContent())
    .toBe("Tools · 2Run snapshotRun goal");
  expect(renderRun).toHaveBeenCalledWith({ toolName: "snapshot" });
  expect(renderRun).toHaveBeenCalledWith({ toolName: "goal" });
});

it("runs an object's actions through the run slot", async () => {
  const { renderRun } = renderLens({
    selection: { kind: "object", path: "TodoPage" },
  });

  await expect
    .poll(() => detail.section("Actions").textContent())
    .toContain("Run TodoPage.addItem");
  expect(renderRun).toHaveBeenCalledWith({ toolName: "TodoPage.addItem" });
});

it("runs a collection item's actions on that item", async () => {
  const { renderRun } = renderLens({
    selection: { kind: "object", path: "TodoPage.items[1]" },
  });

  await expect
    .poll(() => detail.section("Actions").textContent())
    .toContain("Run TodoPage.items.archive");
  expect(renderRun).toHaveBeenCalledWith({
    toolName: "TodoPage.items.archive",
    item: "TodoPage.items[1]",
  });
});

it("lists a model's instances on this page, its actions and its members", async () => {
  renderLens({ selection: { kind: "model", className: "TodoItem" } });

  await expect
    .poll(() =>
      detail.section("On this page").getByRole("button").allTextContents()
    )
    .toEqual(["TodoPage.items[0]", "TodoPage.items[1]"]);
  expect(await detail.section("Actions").textContent()).toContain(
    "Run TodoPage.items.archive"
  );
  expect(await detail.memberDescription("archiveButton")).toBe("locator");
});

it("goes from a model's instance to that Page Object", async () => {
  const { onHover, onSelect } = renderLens({
    selection: { kind: "model", className: "TodoItem" },
  });
  const instance = detail.instance("TodoPage.items[1]");

  await instance.hover();
  await expect
    .poll(() => onHover.mock.lastCall)
    .toEqual([{ path: "TodoPage.items[1]" }]);
  await instance.click();

  expect(onSelect).toHaveBeenLastCalledWith({
    kind: "object",
    path: "TodoPage.items[1]",
  });
});

it("tells a model's locators from its child Page Objects by their icons", async () => {
  renderLens({ selection: { kind: "model", className: "TodoPage" } });

  await expect.poll(() => detail.memberIcon("newItemInput")).toBe("Locator");
  expect(await detail.memberIcon("items")).toBe("Page object");
});

it("selects a Page Object's member by clicking it, and shows it", async () => {
  const { onSelect } = renderLens({
    selection: { kind: "object", path: "TodoPage" },
  });

  await detail.member("newItemInput").click();

  expect(onSelect).toHaveBeenCalledExactlyOnceWith({
    kind: "member",
    path: "TodoPage.newItemInput",
  });
  await expect
    .poll(() => detail.title.textContent())
    .toBe("TodoPage.newItemInput");
  expect(await detail.fact("Declared as").textContent()).toBe("newItemInput");
  expect(await detail.fact("On the page").textContent()).toBe("1 match");
  expect(await detail.fact("Owner").textContent()).toBe("TodoPage");
});

it("goes from a member to the Page Object it belongs to", async () => {
  const { onSelect } = renderLens({
    selection: { kind: "member", path: "TodoPage.items[1].archiveButton" },
  });

  await detail.ownerLink.click();

  expect(onSelect).toHaveBeenCalledExactlyOnceWith({
    kind: "object",
    path: "TodoPage.items[1]",
  });
  await expect.poll(() => detail.title.textContent()).toBe("TodoPage.items[1]");
});

it("shows how a child Page Object member is declared, and goes to its Page Object", async () => {
  const { onSelect } = renderLens({
    selection: { kind: "member", path: "TodoPage.items" },
  });

  await expect
    .poll(() => detail.fact("Declared as").textContent())
    .toBe("items: TodoItem[]");
  expect(await detail.fact("On the page").textContent()).toBe("2 items");
  await detail.objectLink("TodoPage.items").click();
  expect(onSelect).toHaveBeenLastCalledWith({
    kind: "object",
    path: "TodoPage.items",
  });
});

it("goes from a child Page Object member to its model", async () => {
  const { onSelect } = renderLens({
    selection: { kind: "member", path: "TodoPage.items" },
  });

  await detail.modelLink.click();

  expect(onSelect).toHaveBeenLastCalledWith({
    kind: "model",
    className: "TodoItem",
  });
});

it("selects a model's member across its Page Objects on the page", async () => {
  const { onSelect } = renderLens({
    selection: { kind: "model", className: "TodoItem" },
  });

  await detail.member("archiveButton").click();

  expect(onSelect).toHaveBeenCalledExactlyOnceWith({
    kind: "member",
    path: "TodoItem.archiveButton",
  });
  await expect
    .poll(() => detail.fact("On the page").textContent())
    .toBe("on 2 of 2 TodoItem objects");
  await detail.ownerLink.click();
  expect(onSelect).toHaveBeenLastCalledWith({
    kind: "model",
    className: "TodoItem",
  });
});

it("doesn't select a member that is not on the page", async () => {
  const { onSelect } = renderLens({
    selection: { kind: "object", path: "TodoPage.archiveDialog" },
  });

  await expect
    .poll(() => detail.member("confirmButton").isDisabled())
    .toBe(true);
  expect(onSelect).not.toHaveBeenCalled();
});

it("dims a model's actions as not on page when none of its objects is, without running them", async () => {
  const { renderRun } = renderLens({
    selection: { kind: "model", className: "ArchiveDialog" },
  });
  const confirm = detail.offPageAction("confirm");

  await expect.poll(() => confirm.getAttribute("aria-disabled")).toBe("true");
  expect(await confirm.textContent()).toContain("Not on page");
  expect(
    await confirm.evaluate((element) => getComputedStyle(element).opacity)
  ).not.toBe("1");
  expect(renderRun).not.toHaveBeenCalled();
});

it("searches the page's objects, models, actions and members", async () => {
  renderLens();

  await navigator.search("archive");

  await expect
    .poll(async () => (await navigator.searchResults.allTextContents()).sort())
    .toEqual(
      [
        "ObjectTodoPage.archiveDialogArchiveDialog · Not on page",
        "ActionTodoItem.archive",
        "MemberTodoItem.archiveButtonlocator",
        "POMArchiveDialogPage object · not on page",
        "ActionArchiveDialog.confirmConfirm the archive. Not on page.",
        "MemberArchiveDialog.confirmButtonlocator",
      ].sort()
    );
});
