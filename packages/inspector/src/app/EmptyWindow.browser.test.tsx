import { afterEach, expect, it } from "vitest";
import { createPage } from "@ayme-dev/playwright-lite";

import type { InspectorContract } from "@ayme-dev/ayme/inspector";

import { renderInspector } from "./renderInspector";
import { replaceInspectorTransport } from "../shared/infrastructure";

// Component tests: what the Inspector's own window says while its Session
// has told it of no Tab, over a transport the test drives.

const page = createPage();
const hint = page.getByText(
  "This Session has no Tab yet. Once a tab is open in its browser, the Inspector shows it."
);
const unmounts: (() => void)[] = [];

afterEach(() => {
  for (const unmount of unmounts.splice(0)) unmount();
});

/** A transport that never answers, as a Session without a Tab does not. */
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

it("tells a Session's window, before it heard of a Tab, that the Session has none yet", async () => {
  render(true, true);

  await expect.poll(() => hint.isVisible()).toBe(true);
});

it("says nothing in the inline panel", async () => {
  render(false, false);

  const navigator = page.getByRole("navigation", { name: "Navigator" });
  await expect.poll(() => navigator.count()).toBe(1);
  expect(await hint.count()).toBe(0);
});
