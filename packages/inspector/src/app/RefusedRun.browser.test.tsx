import { afterEach, expect, it } from "vitest";
import { createPage } from "@ayme-dev/playwright-lite";

import type {
  InspectorContract,
  InspectorState,
} from "@ayme-dev/ayme/inspector";

import { renderInspector } from "./renderInspector";
import {
  emptyInspectorState,
  replaceInspectorTransport,
} from "../shared/infrastructure";
import { Inspector } from "../../testing";

// Component tests: a Session's window whose Run the Session refuses before
// it starts, over a transport the test drives. Such a Run never reaches the
// page's Run log.

const DIALOG_OPEN =
  'A confirm dialog is open on the tab: "Remove Milk from the basket?". Answer it with your browser automation, then run this command again.';

const page = createPage();
const inspector = new Inspector(
  page,
  page.locator("[data-ayme-inspector-root]")
);
const unmounts: (() => void)[] = [];

afterEach(() => {
  for (const unmount of unmounts.splice(0)) unmount();
  sessionStorage.clear();
});

const state: InspectorState = {
  ...emptyInspectorState,
  revision: 1,
  tools: [
    {
      name: "mark_element",
      agentDescription: "Mark one element on the page.",
      inputSchema: { type: "object" },
      group: "custom",
      available: true,
    },
  ],
};

/** A Session's transport that refuses every Run with `why`. */
function refusingTransport(why: string): InspectorContract {
  const never = () => new Promise<never>(() => {});
  return {
    getState: async () => state,
    subscribe: () => () => {},
    runTool: () => Promise.reject(new Error(why)),
    highlight: never,
    pick: never,
    cancelPick: never,
    look: never,
    recordedPageState: async () => undefined,
    demo: never,
    pomDefinitionText: async () => "",
  };
}

it("shows a Run the Session refused before it started as failed on its card, with why", async () => {
  replaceInspectorTransport(refusingTransport(DIALOG_OPEN), { external: true });
  const host = document.createElement("div");
  document.body.append(host);
  const unmount = renderInspector(host.attachShadow({ mode: "open" }), {
    windowed: true,
  });
  unmounts.push(() => {
    unmount();
    host.remove();
  });

  const card = await inspector.tool("mark_element");
  await card.run();

  await expect.poll(() => card.lastResult.textContent()).toContain("Failed");
  expect(await card.lastResult.textContent()).toContain(DIALOG_OPEN);
});
