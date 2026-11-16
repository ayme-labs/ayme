import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createPage } from "@ayme-dev/playwright-lite";

import type { InspectorPageObject } from "@ayme-dev/ayme/inspector";

import { forest, node } from "../structure/test-utils/projected";
import { renderInspector } from "./renderInspector";
import { startedAyme, type PageFixture } from "../tools/test-utils/startedAyme";
import { Inspector } from "../testing";

// Component tests: a rooted action's Runs by any Caller are on the item
// their ref named, so an item's scope lists them. The runtime is replaced by
// fixture targets, a look at the host page and a stand-in Run log.
const archive: InspectorPageObject["tools"][number] = {
  className: "ListItem",
  methodName: "archive",
  name: "ListItem.archive",
  authorDescription: "Archive the item.",
  agentDescription: "Archive the item.",
  inputSchema: { type: "object" },
  parameters: [],
  rooted: true,
};
const listPage: InspectorPageObject = {
  id: "ListPage",
  manifest: {
    className: "ListPage",
    members: [
      {
        memberName: "items",
        kind: "component",
        access: "field",
        componentClassName: "ListItem",
        collection: true,
      },
    ],
    components: [
      {
        className: "ListItem",
        members: [{ memberName: "root", kind: "locator", access: "field" }],
        tools: [
          {
            methodName: archive.methodName,
            toolName: archive.name,
            description: archive.authorDescription,
            parameters: archive.parameters,
          },
        ],
      },
    ],
    tools: [],
  },
  memberObservations: [
    { memberName: "items", kind: "component-collection", count: 2 },
    ...[0, 1].map((index) => ({
      memberName: `items[${index}].root`,
      kind: "component-root" as const,
      count: 1,
    })),
  ],
  presentPaths: ["", "items[0]", "items[1]"],
  rootMemberPaths: [],
  tools: [archive],
};

const page = createPage();
const inspector = new Inspector(
  page,
  page.locator("[data-ayme-inspector-root]")
);
const unmounts: (() => void)[] = [];
// The page as the look gives it, which a test may change.
let fixture: PageFixture;
const setTargets = (targets: PageFixture["targets"]) =>
  startedAyme.setPage({ ...fixture, targets });

beforeEach(() => {
  const host = document.createElement("ul");
  host.innerHTML = `<li>Milk</li><li>Eggs</li>`;
  document.body.append(host);
  unmounts.push(() => host.remove());
  const [milk, eggs] = host.querySelectorAll("li");

  fixture = {
    projected: forest(
      node(
        { ref: "e1", role: "list", name: "Items" },
        node({ ref: "e2", role: "listitem" }, "Milk"),
        node({ ref: "e3", role: "listitem" }, "Eggs")
      )
    ),
    elementsByRef: new Map<string, Element>([
      ["e1", host],
      ["e2", milk!],
      ["e3", eggs!],
    ]),
    targets: [
      {
        path: "ListPage.items[0].@root",
        element: milk!,
        locator: "locator('li').first()",
      },
      {
        path: "ListPage.items[1].@root",
        element: eggs!,
        locator: "locator('li').nth(1)",
      },
    ],
  };
  startedAyme.setPage(fixture);
  startedAyme.setRegistry({ pageObjects: [listPage] });
  startedAyme.tools.list.mockReturnValue([
    {
      name: archive.name,
      authorDescription: archive.authorDescription,
      agentDescription: archive.agentDescription,
      inputSchema: archive.inputSchema,
      group: "pageObject",
      available: true,
    },
  ]);

  const inspectorHost = document.createElement("div");
  document.body.append(inspectorHost);
  const unmount = renderInspector(inspectorHost.attachShadow({ mode: "open" }));
  unmounts.push(() => {
    unmount();
    inspectorHost.remove();
  });
});

afterEach(() => {
  for (const unmount of unmounts.splice(0).reverse()) unmount();
  vi.clearAllMocks();
  startedAyme.reset();
  localStorage.clear();
  sessionStorage.clear();
});

it("scopes an agent's collection Run to the item its ref named when it started", async () => {
  // A Run's item is read from the latest look at the page when the Run
  // appears, so the first look has to land before the Run starts.
  await inspector.navigator.showLens("Structure");
  await expect.poll(() => inspector.structure.node("e3").count()).toBe(1);
  const model = inspector.navigator.model;
  await inspector.navigator.showLens("Model");
  await expect.poll(() => model.object("ListPage.items[1]").count()).toBe(1);

  startedAyme.runs
    .start("ListItem.archive", { ref: "e3", args: {} }, "webmcp")
    .succeed();

  await model.object("ListPage.items[1]").click();
  await expect.poll(() => inspector.runs.runs.count()).toBe(1);
  await model.object("ListPage.items[0]").click();
  await expect.poll(() => inspector.runs.runs.count()).toBe(0);
});

it("offers one instance when two class members resolve to the same root", async () => {
  const milk = document.querySelector("li")!;
  setTargets(
    [0, 1].map((index) => ({
      path: `ListPage.items[${index}].@root`,
      element: milk,
      locator: "locator('li').first()",
    }))
  );
  const card = await inspector.tool("ListItem.archive");
  await card.openArguments();
  await expect.poll(() => card.items.count()).toBe(1);
  expect(await card.items.getAttribute("aria-checked")).toBe("true");
  await card.run();
  expect(startedAyme.tools.run).toHaveBeenCalledWith("ListItem.archive", {
    ref: "e2",
    args: {},
  });
});

it("does not assign a class instance to a custom tool sharing its namespace", async () => {
  await inspector.navigator.showLens("Structure");
  await expect.poll(() => inspector.structure.node("e3").count()).toBe(1);
  startedAyme.runs.start("ListItem.inspect", { ref: "e3" }, "webmcp").succeed();
  await inspector.navigator.showLens("Model");
  await inspector.navigator.model.object("ListPage.items[1]").click();
  await expect.poll(() => inspector.runs.runs.count()).toBe(0);
});

it("shows a refused class run after its last instance has disappeared", async () => {
  for (const unmount of unmounts.splice(0).reverse()) unmount();
  startedAyme.setRegistry({
    pageObjects: [
      {
        ...listPage,
        memberObservations: [
          { memberName: "items", kind: "component-collection", count: 0 },
        ],
        presentPaths: [""],
      },
    ],
  });
  setTargets([]);
  startedAyme.tools.list.mockReturnValue([]);
  const host = document.createElement("div");
  document.body.append(host);
  const unmount = renderInspector(host.attachShadow({ mode: "open" }));
  unmounts.push(() => {
    unmount();
    host.remove();
  });
  await inspector.navigator.showLens("Model");
  await expect
    .poll(() => inspector.navigator.model.object("ListPage.items[1]").count())
    .toBe(0);
  startedAyme.runs
    .start("ListItem.archive", { ref: "e3", args: {} }, "webmcp")
    .fail("Not a root of ListItem");
  await expect.poll(() => inspector.runs.header.textContent()).toBe("Runs · 1");
  if ((await inspector.runs.header.getAttribute("aria-expanded")) === "false")
    await inspector.runs.header.click();
  await expect.poll(() => inspector.runs.runs.count()).toBe(1);
  expect(await inspector.runs.run(0).root.getAttribute("aria-label")).toBe(
    "ListItem.archive"
  );
});
