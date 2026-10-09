import { afterEach, expect, it } from "vitest";
import { createPage } from "@ayme-dev/playwright-lite";

import { allowPassThrough, passThroughWhileCovered } from "./panelPassThrough";

// Component tests: the panel letting a pointer action through to a page
// element it covers, on playwright-lite, with a stand-in Inspector host.

const page = createPage();
const cleanups: (() => void)[] = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

/** A page button, and an Inspector host covering it when `covering`. */
function setUp({ covering }: { covering: boolean }) {
  const button = document.createElement("button");
  button.textContent = "Add item";
  button.style.cssText = "position: fixed; left: 20px; top: 20px;";
  const host = document.createElement("div");
  host.setAttribute("data-ayme-inspector-host", "");
  host.style.cssText = `position: fixed; inset: ${covering ? 0 : "auto"}; width: 300px; height: 300px; ${covering ? "" : "right: 0; bottom: 0;"}`;
  const shadowRoot = host.attachShadow({ mode: "open" });
  const panelRoot = document.createElement("div");
  panelRoot.setAttribute("data-ayme-inspector-root", "");
  shadowRoot.append(panelRoot);
  document.body.append(button, host);
  const disallow = allowPassThrough(shadowRoot);
  cleanups.push(() => {
    disallow();
    button.remove();
    host.remove();
  });
  return { panelRoot };
}

/**
 * Whether the panel lets pointer events through while the action runs: the
 * action waits up to a second for it.
 */
async function passesThroughDuringAction(panelRoot: Element) {
  return await passThroughWhileCovered(
    [page.getByRole("button", { name: "Add item" })],
    async () => {
      for (let waited = 0; waited < 1000; waited += 25) {
        if (panelRoot.hasAttribute("data-ayme-pass-through")) return true;
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      return false;
    }
  );
}

it("lets the action through while the panel covers its target", async () => {
  const { panelRoot } = setUp({ covering: true });

  expect(await passesThroughDuringAction(panelRoot)).toBe(true);
  expect(panelRoot.hasAttribute("data-ayme-pass-through")).toBe(false);
});

it("keeps taking pointer events while the target is clear of the panel", async () => {
  const { panelRoot } = setUp({ covering: false });

  expect(await passesThroughDuringAction(panelRoot)).toBe(false);
});
