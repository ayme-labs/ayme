import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createPage } from "@ayme-dev/playwright-lite";

import type { PageStatePeek } from "@ayme-dev/ayme/internal";
import { peekPageStateForDocument } from "@ayme-dev/ayme/internal";

import { forest, node } from "./structure/test-utils/projected";
import { renderInspector } from "./renderInspector";
import { Inspector } from "./testing";

// Component tests: the Structure view keeps up with the page on its own,
// with no registry change to prompt it: the mocked registry never reports
// one. The runtime is replaced by a peek that reads the fixture host page,
// so the evidence covers the panel and its adapter's refresh triggers only.
vi.mock("@ayme-dev/ayme/internal", async (importOriginal) => {
  const { pageStateNodeEntry } =
    await importOriginal<typeof import("@ayme-dev/ayme/internal")>();
  return {
    pageStateNodeEntry,
    getPomDefinitions: vi.fn(() => ({ definitions: [] })),
    peekPageStateForDocument: vi.fn(),
    listElementToolTargets: vi.fn(async () => new Map()),
    // One value each, as the runtime keeps them until they change.
    listLiveTools: vi.fn().mockReturnValue([]),
    getPublicationStatus: vi.fn().mockReturnValue({ state: "active" }),
    subscribeToPublishedTools: vi.fn(() => () => {}),
    getPomDefinitionText: vi.fn(() => ""),
    runTool: vi.fn(),
    listRegisteredPomTargets: vi.fn(async () => []),
    listRegisteredPomTools: vi.fn(() => []),
    listRegisteredPoms: vi.fn(() => []),
    subscribeToRegisteredPoms: vi.fn(() => () => true),
  };
});

const page = createPage();
const inspector = new Inspector(
  page,
  page.locator("[data-ayme-inspector-root]")
);
const unmounts: (() => void)[] = [];

/** The host page's state the way an agent reads it, projected from its DOM. */
function projectedPageState(host: Element) {
  const input = host.querySelector("input:not([type])") as HTMLInputElement;
  const checkbox = host.querySelector("[type=checkbox]") as HTMLInputElement;
  const note = host.querySelector("p")!;
  return forest(
    node(
      { ref: "e1", role: "textbox", name: "Name" },
      ...(input.value ? [input.value] : [])
    ),
    node({
      ref: "e2",
      role: "checkbox",
      name: "Done",
      state: checkbox.checked ? { checked: true } : {},
    }),
    node({ ref: "e3", role: "paragraph" }, note.textContent ?? "")
  );
}

beforeEach(() => {
  const host = document.createElement("div");
  host.innerHTML = `
    <input aria-label="Name" />
    <label><input type="checkbox" /> Done</label>
    <p>Draft</p>`;
  document.body.append(host);
  unmounts.push(() => host.remove());
  vi.mocked(peekPageStateForDocument).mockImplementation(
    async () =>
      ({
        projected: projectedPageState(host),
        elementsByRef: new Map(),
      }) as unknown as PageStatePeek
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
});

const structure = () => inspector.structure.rows.allTextContents();

async function showStructure() {
  await inspector.navigator.showLens("Structure");
  await expect.poll(structure).toContain('"Draft"');
}

it("shows what's typed into the page", async () => {
  await showStructure();

  await page.getByRole("textbox", { name: "Name" }).fill("Ada");

  await expect.poll(structure).toContain('"Ada"');
});

it("looks at the page again when a checkbox is checked", async () => {
  await showStructure();

  await page.getByRole("checkbox", { name: "Done" }).check();

  // Rows show no states, so the look itself is the evidence: the page
  // state it read has the checkbox checked.
  await expect
    .poll(async () => {
      const looks = vi.mocked(peekPageStateForDocument).mock.results;
      const checkbox = (await looks.at(-1)?.value)?.projected.roots[1];
      return typeof checkbox === "string" ? undefined : checkbox?.state;
    })
    .toEqual({ checked: true });
});

it("shows text changing on the page", async () => {
  await showStructure();

  document.querySelector("p")!.textContent = "Sent";

  await expect.poll(structure).toContain('"Sent"');
});
