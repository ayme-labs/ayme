import { useState } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { createPage } from "@ayme-dev/playwright-lite";

import { renderPart } from "../renderPart";
import { Navigator as NavigatorPart } from "../testing";
import type { Lens, LensId } from "./lens";
import { Navigator } from "./Navigator";
import type { Selection } from "./selection";

// Component tests: the navigator with fixture lenses, driven by its page
// object on playwright-lite. The lenses stand in for tickets E, F and G's.

const navigator = new NavigatorPart(
  createPage().getByRole("navigation", { name: "Navigator" })
);
const unmounts: (() => void)[] = [];

afterEach(() => {
  for (const unmount of unmounts.splice(0)) unmount();
});

function lens(id: LensId, label: string, extra: Partial<Lens> = {}): Lens {
  return {
    id,
    label,
    tree: <p>The {label} tree</p>,
    searchEntries: [],
    legend: {},
    detail: () => undefined,
    ...extra,
  };
}

const addItem: Selection = { kind: "tool", name: "ListPage.addItem" };

const lenses = [
  lens("model", "Model", {
    searchEntries: [
      {
        key: "model:ListPage",
        kind: "POM",
        label: "ListPage",
        description: "Page object · 1 on page",
        selection: { kind: "model", className: "ListPage" },
      },
    ],
    legend: { live: 3, notOnPage: 1 },
  }),
  lens("structure", "Structure", {
    searchEntries: [
      {
        key: "node:e4",
        kind: "Ref",
        label: 'e4 button "Add item"',
        description: "ListPage.addItemButton",
        selection: { kind: "node", ref: "e4" },
      },
    ],
    legend: { refs: 14 },
  }),
  lens("tools", "Tools", {
    searchEntries: [
      {
        key: "tool:ListPage.addItem",
        kind: "Action",
        label: "ListPage.addItem",
        description: "Add an item to the list.",
        selection: addItem,
      },
    ],
  }),
];

function renderNavigator({
  onSelect = vi.fn(),
}: { onSelect?: (selection: Selection) => void } = {}) {
  function Harness() {
    const [activeLens, setActiveLens] = useState<LensId>("model");
    return (
      <Navigator
        lenses={lenses}
        activeLens={activeLens}
        onLensChange={setActiveLens}
        onSelect={onSelect}
      />
    );
  }
  unmounts.push(renderPart(<Harness />));
}

it("shows the active lens's tree and switches lenses", async () => {
  renderNavigator();
  await expect
    .poll(() => navigator.root.textContent())
    .toContain("The Model tree");

  await navigator.showLens("Structure");

  await expect
    .poll(() => navigator.lens("Structure").getAttribute("aria-pressed"))
    .toBe("true");
  await expect
    .poll(() => navigator.root.textContent())
    .toContain("The Structure tree");
  expect(await navigator.root.textContent()).not.toContain("The Model tree");
});

it("searches every lens at once", async () => {
  renderNavigator();

  await navigator.search("add");

  await expect
    .poll(() => navigator.searchResults.allTextContents())
    .toEqual([
      'Refe4 button "Add item"ListPage.addItemButton',
      "ActionListPage.addItemAdd an item to the list.",
    ]);
});

it("selects a result and shows it in its lens", async () => {
  const onSelect = vi.fn();
  renderNavigator({ onSelect });
  await navigator.search("add an item");

  await navigator.result("ListPage.addItem").click();

  expect(onSelect).toHaveBeenCalledExactlyOnceWith(addItem);
  await expect
    .poll(() => navigator.lens("Tools").getAttribute("aria-pressed"))
    .toBe("true");
  await expect.poll(() => navigator.searchBox.inputValue()).toBe("");
  await expect
    .poll(() => navigator.root.textContent())
    .toContain("The Tools tree");
});

it("says so when nothing matches", async () => {
  renderNavigator();

  await navigator.search("checkout");

  await expect.poll(() => navigator.noResults.isVisible()).toBe(true);
});

it("counts what every lens knows in the legend", async () => {
  renderNavigator();

  await expect
    .poll(() => navigator.legend.textContent())
    .toBe("3 live1 not on page14 refs");
});
