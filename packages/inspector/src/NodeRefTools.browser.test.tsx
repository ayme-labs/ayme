import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createPage } from "@ayme-dev/playwright-lite";

import type { PageStatePeek } from "@ayme-dev/ayme/internal";

import { renderInspector } from "./renderInspector";
import { Inspector } from "./testing";

// Component tests: a node's Ref tools while WebMCP publishes nothing. The
// runtime is replaced by a peek of the host page, live Ref tools that are
// not published, and the refs each can take, so the evidence covers the
// panel and its adapter.
vi.mock("@ayme-dev/ayme/internal", () => {
  const refTool = (name: string) => ({
    name,
    description: `${name} by ref.`,
    inputSchema: { type: "object" },
    group: "ref",
  });
  return {
    getPomDefinitions: vi.fn(() => ({ definitions: [] })),
    peekPageStateForDocument: vi.fn(
      async () =>
        ({
          text: '- e1 main:\n  - e2 textbox "Name"\n  - e3 button "Save"',
          elementsByRef: new Map(),
        }) as unknown as PageStatePeek
    ),
    listRefToolTargets: vi.fn(
      async () =>
        new Map([
          ["click_page_state_ref", ["e2", "e3"]],
          ["fill_page_state_ref", ["e2"]],
        ])
    ),
    listLiveTools: vi
      .fn()
      .mockReturnValue([
        refTool("click_page_state_ref"),
        refTool("fill_page_state_ref"),
      ]),
    getPublicationStatus: vi.fn().mockReturnValue({ state: "disabled" }),
    subscribeToPublishedTools: vi.fn(() => () => {}),
    getPomDefinitionText: vi.fn(() => ""),
    listRegisteredPomTargets: vi.fn(async () => []),
    listRegisteredPomTools: vi.fn(() => []),
    listRegisteredPoms: vi.fn(() => []),
    runTool: vi.fn(),
    subscribeToRegisteredPoms: vi.fn(() => () => true),
  };
});

const page = createPage();
const inspector = new Inspector(
  page,
  page.locator("[data-ayme-inspector-root]")
);
const unmounts: (() => void)[] = [];

beforeEach(() => {
  const host = document.createElement("div");
  document.body.append(host);
  const unmount = renderInspector(host.attachShadow({ mode: "open" }));
  unmounts.push(() => {
    unmount();
    host.remove();
  });
});

afterEach(() => {
  for (const unmount of unmounts.splice(0)) unmount();
  localStorage.clear();
});

it("offers a node its live Ref tools while nothing is published", async () => {
  await inspector.navigator.showLens("Structure");

  await inspector.structure.pick("e2");

  await expect
    .poll(() => inspector.detail.node.tool("fill_page_state_ref").count())
    .toBe(1);
  expect(await inspector.detail.node.tool("click_page_state_ref").count()).toBe(
    1
  );
});

it("offers a node only the live Ref tools that can take its ref", async () => {
  await inspector.navigator.showLens("Structure");

  await inspector.structure.pick("e3");

  await expect
    .poll(() => inspector.detail.node.tool("click_page_state_ref").count())
    .toBe(1);
  expect(await inspector.detail.node.tool("fill_page_state_ref").count()).toBe(
    0
  );
});
