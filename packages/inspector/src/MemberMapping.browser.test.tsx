import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createPage } from "@ayme-dev/playwright-lite";

import type { PageStatePeek, RegisteredPom } from "@ayme-dev/ayme/internal";
import {
  listRegisteredPomTargets,
  listRegisteredPoms,
  peekPageStateForDocument,
} from "@ayme-dev/ayme/internal";

import { forest, node } from "./adapter/projected.testSupport";
import { renderInspector } from "./renderInspector";
import { Inspector } from "./testing";

// Component tests: two collections over the same list items, and a locator
// over them too. Each member's items are there to find, whichever the
// registry lists first. The runtime is replaced by fixture targets and a
// peek of the host page, so the evidence covers the panel and its adapter.
vi.mock("@ayme-dev/ayme/internal", async (importOriginal) => {
  const { pageStateNodeLines } =
    await importOriginal<typeof import("@ayme-dev/ayme/internal")>();
  return {
    pageStateNodeLines,
    getPomDefinitions: vi.fn(() => ({ definitions: [] })),
    peekPageStateForDocument: vi.fn(),
    listElementToolTargets: vi.fn(async () => new Map()),
    listLiveTools: vi.fn().mockReturnValue([]),
    getPublicationStatus: vi.fn().mockReturnValue({ state: "active" }),
    subscribeToPublishedTools: vi.fn(() => () => {}),
    getPomDefinitionText: vi.fn(() => ""),
    runTool: vi.fn(),
    listRegisteredPomTargets: vi.fn(),
    listRegisteredPomTools: vi.fn(() => []),
    listRegisteredPoms: vi.fn(() => []),
    subscribeToRegisteredPoms: vi.fn(() => () => true),
  };
});

const collectionOfItems = (memberName: string) =>
  ({
    memberName,
    kind: "component",
    access: "field",
    componentClassName: "ListItem",
    collection: true,
  }) as const;
const listPage: RegisteredPom = {
  id: "ListPage",
  instance: {},
  manifest: {
    className: "ListPage",
    members: [
      { memberName: "rows", kind: "locator", access: "field" },
      collectionOfItems("items"),
      collectionOfItems("entries"),
    ],
    components: [
      {
        className: "ListItem",
        members: [{ memberName: "root", kind: "locator", access: "field" }],
        tools: [],
      },
    ],
    tools: [],
  },
  memberObservations: [
    { memberName: "rows", kind: "locator", count: 2 },
    ...["items", "entries"].flatMap((collection) => [
      {
        memberName: collection,
        kind: "component-collection" as const,
        count: 2,
      },
      ...[0, 1].map((index) => ({
        memberName: `${collection}[${index}].root`,
        kind: "component-root" as const,
        count: 1,
      })),
    ]),
  ],
  tools: [],
};

const page = createPage();
const inspector = new Inspector(
  page,
  page.locator("[data-ayme-inspector-root]")
);
const unmounts: (() => void)[] = [];

beforeEach(() => {
  const host = document.createElement("ul");
  host.innerHTML = `<li data-ref="e2">Milk</li><li data-ref="e3">Eggs</li>`;
  document.body.append(host);
  unmounts.push(() => host.remove());
  const [milk, eggs] = host.querySelectorAll("li");

  vi.mocked(peekPageStateForDocument).mockImplementation(
    async () =>
      ({
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
      }) as unknown as PageStatePeek
  );
  vi.mocked(listRegisteredPoms).mockReturnValue([listPage]);
  // The later collection comes last, where it used to be hidden.
  vi.mocked(listRegisteredPomTargets).mockResolvedValue([
    { path: "ListPage.rows", element: milk! },
    { path: "ListPage.rows", element: eggs! },
    { path: "ListPage.items[0].root", element: milk! },
    { path: "ListPage.items[1].root", element: eggs! },
    { path: "ListPage.entries[0].root", element: milk! },
    { path: "ListPage.entries[1].root", element: eggs! },
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
  localStorage.clear();
});

/** The refs among the search results; the Model lens finds the objects. */
const refsFound = async () =>
  (await inspector.navigator.searchResults.allTextContents()).flatMap(
    (text) => /^Ref(e\d+)/.exec(text)?.[1] ?? []
  );

it.each(["ListPage.items[1]", "ListPage.entries[1]"])(
  "finds the item %s on the page",
  async (item) => {
    await inspector.navigator.search(item);

    await expect.poll(refsFound).toEqual(["e3"]);
  }
);

it("finds every item a locator over the same items holds", async () => {
  await inspector.navigator.search("ListPage.rows");

  await expect.poll(refsFound).toEqual(["e2", "e3"]);
});
