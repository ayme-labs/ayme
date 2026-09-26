import { useState } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { createPage } from "@ayme-dev/playwright-lite";

import type { PageModel, PageObjectNode } from "../adapter/pageModel";
import { DetailPane } from "../frame/InspectorBody";
import type { LensId } from "../frame/lens";
import { Navigator } from "../frame/Navigator";
import type { RenderRun } from "../frame/runSlot";
import type { Selection } from "../frame/selection";
import { renderPart } from "../renderPart";
import {
  DetailPane as DetailPanePart,
  Navigator as NavigatorPart,
} from "../testing";
import { modelLens } from "./modelLens";

// Component tests: the Model lens in the navigator and the detail pane, with
// a fixture page model, driven through the Inspector's page objects on
// playwright-lite. The highlight and the run slot are stand-ins, so the
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
  name: `[${index}]`,
  kind: "item",
  className: "TodoItem",
  live: true,
  highlightPath: `TodoPage.items[${index}].root`,
  members: [
    {
      name: "archiveButton",
      kind: "locator",
      live: true,
      state: "1 match",
      highlightPath: `TodoPage.items[${index}].archiveButton`,
    },
  ],
  actions: [
    {
      name: "archive",
      description: `Archive ${label}.`,
      signature: "()",
      toolName: "TodoPage.items.archive",
      published: true,
    },
  ],
  children: [],
});

const items = [item(0, "Water plants"), item(1, "Pay rent")];

const dialog: PageObjectNode = {
  path: "TodoPage.archiveDialog",
  name: "archiveDialog",
  kind: "component",
  className: "ArchiveDialog",
  live: false,
  highlightPath: "TodoPage.archiveDialog.root",
  members: [
    {
      name: "confirmButton",
      kind: "locator",
      live: false,
      state: "absent",
      highlightPath: "TodoPage.archiveDialog.confirmButton",
    },
  ],
  actions: [],
  children: [],
};

const todoPage: PageObjectNode = {
  path: "TodoPage",
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
      highlightPath: "TodoPage.newItemInput",
    },
    {
      name: "items",
      kind: "component",
      className: "TodoItem",
      collection: true,
      live: true,
      state: "2 items",
      highlightPath: "TodoPage.items",
      objectPath: "TodoPage.items",
    },
    {
      name: "archiveDialog",
      kind: "component",
      className: "ArchiveDialog",
      live: false,
      state: "not on page",
      highlightPath: "TodoPage.archiveDialog.root",
      objectPath: "TodoPage.archiveDialog",
    },
  ],
  actions: [
    {
      name: "addItem",
      description: "Add an item.",
      signature: "(text: string)",
      toolName: "TodoPage.addItem",
      published: true,
    },
  ],
  children: [
    {
      path: "TodoPage.items",
      name: "items",
      kind: "collection",
      className: "TodoItem",
      live: true,
      itemCount: 2,
      highlightPath: "TodoPage.items",
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
          highlightPath: "TodoPage.newItemInput",
        },
        {
          name: "items",
          kind: "component",
          className: "TodoItem",
          collection: true,
        },
      ],
      actions: [
        {
          name: "addItem",
          signature: "(text: string)",
          toolNames: ["TodoPage.addItem"],
          publishedToolNames: ["TodoPage.addItem"],
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
          highlightPath: "TodoItem.archiveButton",
        },
      ],
      actions: [
        {
          name: "archive",
          signature: "()",
          toolNames: ["TodoPage.items.archive"],
          publishedToolNames: ["TodoPage.items.archive"],
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
          highlightPath: "ArchiveDialog.confirmButton",
        },
      ],
      actions: [
        {
          name: "confirm",
          description: "Confirm the archive.",
          signature: "()",
          toolNames: ["TodoPage.archiveDialog.confirm"],
          publishedToolNames: [],
        },
      ],
      instancePaths: [],
    },
  ],
};

function renderLens({
  selection: initial = { kind: "page" },
}: { selection?: Selection } = {}) {
  const highlight = {
    previewTarget: vi.fn(),
    clearPreview: vi.fn(),
    togglePinnedTarget: vi.fn(),
  };
  const onSelect = vi.fn();
  const renderRun = vi.fn<RenderRun>(({ toolName }) => (
    <button type="button">Run {toolName}</button>
  ));

  function Harness() {
    const [selection, setSelection] = useState(initial);
    const [activeLens, setActiveLens] = useState<LensId>("model");
    const [pinnedPath, setPinnedPath] = useState<string>();
    const model = modelLens({
      host: "localhost:5173",
      pageModel,
      selection,
      onSelect: (next) => {
        onSelect(next);
        setSelection(next);
      },
      highlight: {
        pinnedPath,
        previewTarget: highlight.previewTarget,
        clearPreview: highlight.clearPreview,
        togglePinnedTarget: (path) => {
          highlight.togglePinnedTarget(path);
          setPinnedPath((current) => (current === path ? undefined : path));
        },
      },
      renderRun,
    });
    return (
      <div className="flex" style={{ width: 800, height: 600 }}>
        <Navigator
          lenses={[model]}
          activeLens={activeLens}
          onLensChange={setActiveLens}
          onSelect={(next) => {
            onSelect(next);
            setSelection(next);
          }}
        />
        <DetailPane>{model.detail(selection)}</DetailPane>
      </div>
    );
  }
  unmounts.push(renderPart(<Harness />));
  return { highlight, onSelect, renderRun };
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

it("highlights an object while it is hovered, and pins it when it is picked", async () => {
  const { highlight, onSelect } = renderLens();
  const secondItem = lens.object("TodoPage.items[1]");

  await secondItem.hover();
  await expect
    .poll(() => highlight.previewTarget)
    .toHaveBeenCalledWith("TodoPage.items[1].root");
  await secondItem.click();

  expect(onSelect).toHaveBeenCalledWith({
    kind: "object",
    path: "TodoPage.items[1]",
  });
  expect(highlight.togglePinnedTarget).toHaveBeenCalledExactlyOnceWith(
    "TodoPage.items[1].root"
  );
  await expect
    .poll(() => secondItem.getAttribute("aria-selected"))
    .toBe("true");
});

it("doesn't highlight an object that is not on the page", async () => {
  const { highlight } = renderLens();

  await lens.object("TodoPage.archiveDialog").hover();
  await lens.object("TodoPage.items[0]").hover();

  await expect
    .poll(() => highlight.previewTarget.mock.calls)
    .toEqual([["TodoPage.items[0].root"]]);
});

it("highlights a member while it is hovered, and pins and unpins it on click", async () => {
  const { highlight } = renderLens({
    selection: { kind: "object", path: "TodoPage" },
  });
  const input = detail.member("newItemInput");

  await input.hover();
  await expect
    .poll(() => highlight.previewTarget)
    .toHaveBeenCalledWith("TodoPage.newItemInput");
  await input.click();
  await expect.poll(() => input.getAttribute("aria-pressed")).toBe("true");
  await input.click();

  await expect.poll(() => input.getAttribute("aria-pressed")).toBe("false");
  expect(highlight.togglePinnedTarget.mock.calls).toEqual([
    ["TodoPage.newItemInput"],
    ["TodoPage.newItemInput"],
  ]);
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

it("goes from an object's child member to that child", async () => {
  const { onSelect } = renderLens({
    selection: { kind: "object", path: "TodoPage" },
  });

  await detail.member("items").click();

  expect(onSelect).toHaveBeenCalledWith({
    kind: "object",
    path: "TodoPage.items",
  });
  await expect.poll(() => detail.title.textContent()).toBe("TodoPage.items");
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

it("runs an object's actions through the run slot", async () => {
  const { renderRun } = renderLens({
    selection: { kind: "object", path: "TodoPage" },
  });

  await expect
    .poll(() => detail.section("Actions").textContent())
    .toContain("Run TodoPage.addItem");
  expect(renderRun).toHaveBeenCalledWith({ toolName: "TodoPage.addItem" });
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
  const { highlight, onSelect } = renderLens({
    selection: { kind: "model", className: "TodoItem" },
  });
  const instance = detail.instance("TodoPage.items[1]");

  await instance.hover();
  await expect
    .poll(() => highlight.previewTarget)
    .toHaveBeenCalledWith("TodoPage.items[1].root");
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

it("goes from a model's child Page Object member to its model", async () => {
  renderLens({ selection: { kind: "model", className: "TodoPage" } });

  await detail.member("items").click();

  await expect.poll(() => detail.title.textContent()).toBe("TodoItem");
});

it("shows a model's unpublished actions dimmed, without running them", async () => {
  const { renderRun } = renderLens({
    selection: { kind: "model", className: "ArchiveDialog" },
  });
  const confirm = detail.unpublishedAction("confirm");

  await expect.poll(() => confirm.getAttribute("aria-disabled")).toBe("true");
  expect(await confirm.textContent()).toContain("Not published");
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
        "ActionArchiveDialog.confirmConfirm the archive. Not published.",
        "MemberArchiveDialog.confirmButtonlocator",
      ].sort()
    );
});
