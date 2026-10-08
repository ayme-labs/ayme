import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createPage } from "@ayme-dev/playwright-lite";

import type { PageStateLook } from "@ayme-dev/ayme/internal";
import {
  listRegisteredPomTargets,
  lookAtPageStateForDocument,
  listRegisteredPoms,
  type RegisteredPom,
} from "@ayme-dev/ayme/internal";

import { forest, node } from "../structure/test-utils/projected";
import { renderInspector } from "./renderInspector";
import { Inspector } from "../testing";

// Component tests of the page's two highlights through the whole panel: the
// dashed one follows the pointer in the panel, the solid one follows the
// selection. The runtime is replaced by a fixture host page whose elements
// carry their refs in the page state it looks at, so the evidence covers the
// panel and its runtime wiring only.
vi.mock("@ayme-dev/ayme/internal", async (importOriginal) => {
  const { appProcessToolsOf, asStartedAyme } =
    await import("../tools/test-utils/startedAyme");
  const { pageStateNodeEntry, toolInputViolations } =
    await importOriginal<typeof import("@ayme-dev/ayme/internal")>();
  return {
    pageStateNodeEntry,
    toolInputViolations,
    getPomDefinitions: vi.fn(() => ({ definitions: [] })),
    lookAtPageStateForDocument: vi.fn(),
    listElementToolTargets: vi.fn(async () => new Map()),
    getPomDefinitionText: vi.fn(() => ""),
    getPageStateForElements: vi.fn(async () => ({ refs: [] })),
    listRegisteredPomTargets: vi.fn(),
    listRegisteredPomTools: vi.fn(() => []),
    getStartedAyme: asStartedAyme,
    getAppProcessTools: appProcessToolsOf,
    subscribeToStartedAyme: () => () => {},
    listRegisteredPoms: vi.fn(),
    subscribeToRegisteredPoms: vi.fn(() => () => true),
  };
});

const page = createPage();
// The panel renders into an open root this test owns.
const inspector = new Inspector(
  page,
  page.locator("[data-ayme-inspector-root]")
);
const unmounts: (() => void)[] = [];

// The host page: an editor whose root holds a title field and a save button.
const hostPage = `
  <section data-ref="e1" data-path="Editor.root">
    <input data-ref="e2" data-path="Editor.titleInput" aria-label="Title" />
    <button data-ref="e3" data-path="Editor.saveButton">Save</button>
  </section>`;
const structure = forest(
  node(
    { ref: "e1", role: "region", name: "Editor" },
    node({ ref: "e2", role: "textbox", name: "Title" }),
    node({ ref: "e3", role: "button", name: "Save" })
  )
);

const editor: RegisteredPom = {
  id: "Editor",
  instance: {},
  manifest: {
    className: "Editor",
    members: [
      { memberName: "titleInput", kind: "locator", access: "field" },
      { memberName: "saveButton", kind: "locator", access: "field" },
    ],
    components: [],
    tools: [],
  },
  memberObservations: [
    { memberName: "titleInput", kind: "locator", count: 1 },
    { memberName: "saveButton", kind: "locator", count: 1 },
  ],
  tools: [],
};

function element(ref: string) {
  return document.querySelector(`[data-ref="${ref}"]`)!;
}

beforeEach(() => {
  const host = document.createElement("div");
  host.innerHTML = hostPage;
  document.body.append(host);
  unmounts.push(() => host.remove());

  vi.mocked(listRegisteredPoms).mockReturnValue([editor]);
  vi.mocked(listRegisteredPomTargets).mockImplementation(async () =>
    [...host.querySelectorAll("[data-path]")].map((target) => ({
      path: target.getAttribute("data-path")!,
      element: target,
      locator: `locator('[data-path="${target.getAttribute("data-path")}"]')`,
    }))
  );
  vi.mocked(lookAtPageStateForDocument).mockImplementation(
    async () =>
      ({
        projected: structure,
        elementsByRef: new Map(
          [...host.querySelectorAll("[data-ref]")].map((target) => [
            target.getAttribute("data-ref")!,
            target,
          ])
        ),
      }) as unknown as PageStateLook
  );

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
  sessionStorage.clear();
});

/** Which highlight each host element shows: "hover", "selection", both or none. */
function highlights() {
  return Object.fromEntries(
    ["e1", "e2", "e3"].map((ref) => {
      const target = element(ref);
      const shown = [
        target.hasAttribute("data-ayme-hover") && "hover",
        target.hasAttribute("data-ayme-highlight") && "selection",
      ].filter(Boolean);
      return [ref, shown.join("+") || "none"];
    })
  );
}

const objects = inspector.navigator.model;
const member = (name: string) => inspector.detail.model.member(name);

it("highlights what the pointer is over, until it leaves", async () => {
  await inspector.navigator.search("saveButton");
  await inspector.navigator.result("Editor.saveButton").hover();

  await expect
    .poll(highlights)
    .toEqual({ e1: "none", e2: "none", e3: "hover" });

  await inspector.navigator.searchBox.hover();

  await expect.poll(highlights).toEqual({ e1: "none", e2: "none", e3: "none" });
});

it("highlights the selection, and moves the highlight with it", async () => {
  await objects.object("Editor").click();
  await inspector.navigator.searchBox.hover();

  await expect
    .poll(highlights)
    .toEqual({ e1: "selection", e2: "none", e3: "none" });

  await inspector.navigator.search("title");
  await inspector.navigator.result('e2 textbox "Title"').click();

  await expect
    .poll(highlights)
    .toEqual({ e1: "none", e2: "selection", e3: "none" });
});

it("clears the selection's highlight when nothing on the page is selected", async () => {
  await objects.object("Editor").click();
  await inspector.navigator.searchBox.hover();
  await expect
    .poll(highlights)
    .toEqual({ e1: "selection", e2: "none", e3: "none" });

  await objects.object("Page /").click();

  await expect.poll(highlights).toEqual({ e1: "none", e2: "none", e3: "none" });
});

it("shows both highlights at once", async () => {
  await objects.object("Editor").click();

  await member("saveButton").hover();

  await expect
    .poll(highlights)
    .toEqual({ e1: "selection", e2: "none", e3: "hover" });
});
