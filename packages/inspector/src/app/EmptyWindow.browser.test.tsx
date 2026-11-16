import { afterEach, expect, it } from "vitest";
import { createPage } from "@ayme-dev/playwright-lite";

import type { InspectorContract } from "@ayme-dev/ayme/inspector";

import { renderInspector } from "./renderInspector";
import { replaceInspectorTransport } from "../shared";

// Component tests: what the Inspector's own window says while no page serves
// the contract, over a transport the test drives.

const page = createPage();
const hint = page.getByText("No page is serving the Inspector.");
const unmounts: (() => void)[] = [];

afterEach(() => {
  for (const unmount of unmounts.splice(0)) unmount();
});

/** A transport whose page never answers, as a paired inline session does not. */
function silentTransport(): InspectorContract {
  const never = () => new Promise<never>(() => {});
  return {
    getState: never,
    subscribe: () => () => {},
    runTool: never,
    highlight: never,
    pick: never,
    cancelPick: never,
    look: never,
    recordedPageState: never,
    demo: never,
    pomDefinitionText: never,
  };
}

function render(windowed: boolean, external: boolean) {
  replaceInspectorTransport(silentTransport(), { external });
  const host = document.createElement("div");
  document.body.append(host);
  const unmount = renderInspector(host.attachShadow({ mode: "open" }), {
    windowed,
  });
  unmounts.push(() => {
    unmount();
    host.remove();
  });
}

it("tells the external window to pair a page and start its session with the external placement", async () => {
  render(true, true);

  await expect.poll(() => hint.isVisible()).toBe(true);
  expect(
    await page.getByText('inspector: { placement: "external" }').count()
  ).toBe(1);
});

it("says nothing in the inline panel", async () => {
  render(false, false);

  const navigator = page.getByRole("navigation", { name: "Navigator" });
  await expect.poll(() => navigator.count()).toBe(1);
  expect(await hint.count()).toBe(0);
});
