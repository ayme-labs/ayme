import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createPage } from "@ayme-dev/playwright-lite";

import type { PageStatePeek } from "@ayme-dev/webmcp/internal";
import { peekPageStateForDocument } from "@ayme-dev/webmcp/internal";

import { renderInspector } from "./renderInspector";
import { Inspector } from "./testing";

// Component tests: the Structure view keeps up with the page on its own,
// with no registry change to prompt it: the mocked registry never reports
// one. The runtime is replaced by a peek that reads the fixture host page,
// so the evidence covers the panel and its adapter's refresh triggers only.
vi.mock("@ayme-dev/webmcp/internal", () => ({
  peekPageStateForDocument: vi.fn(),
  listRefToolTargets: vi.fn(async () => new Map()),
  listLiveTools: vi.fn().mockReturnValue([]),
  getPublicationStatus: vi.fn().mockReturnValue({ state: "active" }),
  subscribeToPublishedTools: vi.fn(() => () => {}),
  getPomDefinitionText: vi.fn(() => ""),
  listRegisteredPomTargets: vi.fn(async () => []),
  listRegisteredPomTools: vi.fn(() => []),
  listRegisteredPoms: vi.fn(() => []),
  subscribeToRegisteredPoms: vi.fn(() => () => true),
}));

const page = createPage();
const inspector = new Inspector(
  page,
  page.locator("[data-ayme-inspector-root]")
);
const unmounts: (() => void)[] = [];

/** The host page's state the way an agent reads it, rendered from its DOM. */
function pageStateText(host: Element) {
  const input = host.querySelector("input:not([type])") as HTMLInputElement;
  const checkbox = host.querySelector("[type=checkbox]") as HTMLInputElement;
  const note = host.querySelector("p")!;
  return [
    `- e1 textbox "Name": ${input.value}`,
    `- e2 checkbox "Done"${checkbox.checked ? " [checked]" : ""}`,
    `- e3 paragraph: ${note.textContent}`,
  ].join("\n");
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
        text: pageStateText(host),
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

const structure = () => inspector.pageState.root.textContent();

async function showStructure() {
  await inspector.navigator.showLens("Structure");
  await expect.poll(structure).toContain("paragraph: Draft");
}

it("shows what's typed into the page", async () => {
  await showStructure();

  await page.getByRole("textbox", { name: "Name" }).fill("Ada");

  await expect.poll(structure).toContain('textbox "Name": Ada');
});

it("shows a checkbox being checked", async () => {
  await showStructure();

  await page.getByRole("checkbox", { name: "Done" }).check();

  await expect.poll(structure).toContain('checkbox "Done" [checked]');
});

it("shows text changing on the page", async () => {
  await showStructure();

  document.querySelector("p")!.textContent = "Sent";

  await expect.poll(structure).toContain("paragraph: Sent");
});
