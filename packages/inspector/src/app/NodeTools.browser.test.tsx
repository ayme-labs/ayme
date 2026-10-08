import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createPage } from "@ayme-dev/playwright-lite";

import type { PageStateLook } from "@ayme-dev/ayme/internal";

import { renderInspector } from "./renderInspector";
import { Inspector } from "../testing";

// Component tests: a node's single-element tools while WebMCP publishes nothing. The
// runtime is replaced by a look at the host page, live single-element tools that are
// not published, and the refs each can take, so the evidence covers the
// panel and its runtime wiring.
vi.mock("@ayme-dev/ayme/internal", async (importOriginal) => {
  const { appProcessToolsOf, asStartedAyme, startedAyme } =
    await import("../tools/test-utils/startedAyme");
  const { pageStateNodeEntry, toolInputViolations } =
    await importOriginal<typeof import("@ayme-dev/ayme/internal")>();
  const { forest, node } = await import("../structure/test-utils/projected");
  const browserTool = (name: string) => ({
    name,
    description: `${name} by ref.`,
    inputSchema: { type: "object" as const },
    group: "browser" as const,
  });
  startedAyme.tools.list.mockReturnValue([
    browserTool("click"),
    browserTool("fill"),
  ]);
  startedAyme.webMCP.publicationStatus = {
    state: "disabled",
    message: "WebMCP publication is disabled.",
  };
  return {
    pageStateNodeEntry,
    subscribeToAgentImageRuns: () => () => {},
    toolInputViolations,
    getPomDefinitions: vi.fn(() => ({ definitions: [] })),
    lookAtPageStateForDocument: vi.fn(
      async () =>
        ({
          projected: forest(
            node(
              { ref: "e1", role: "main" },
              node({ ref: "e2", role: "textbox", name: "Name" }),
              node({ ref: "e3", role: "button", name: "Save" })
            )
          ),
          elementsByRef: new Map(),
        }) as unknown as PageStateLook
    ),
    listElementToolTargets: vi.fn(
      async () =>
        new Map([
          ["click", ["e2", "e3"]],
          ["fill", ["e2"]],
        ])
    ),
    getPomDefinitionText: vi.fn(() => ""),
    listRegisteredPomTargets: vi.fn(async () => []),
    listRegisteredPomTools: vi.fn(() => []),
    listRegisteredPoms: vi.fn(() => []),
    getStartedAyme: asStartedAyme,
    getAppProcessTools: appProcessToolsOf,
    subscribeToStartedAyme: () => () => {},
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
  sessionStorage.clear();
});

it("offers a node its live single-element tools while nothing is published", async () => {
  await inspector.navigator.showLens("Structure");

  await inspector.structure.pick("e2");

  await expect.poll(() => inspector.detail.node.tool("fill").count()).toBe(1);
  expect(await inspector.detail.node.tool("click").count()).toBe(1);
});

it("offers a node only the live single-element tools that can take its ref", async () => {
  await inspector.navigator.showLens("Structure");

  await inspector.structure.pick("e3");

  await expect.poll(() => inspector.detail.node.tool("click").count()).toBe(1);
  expect(await inspector.detail.node.tool("fill").count()).toBe(0);
});
