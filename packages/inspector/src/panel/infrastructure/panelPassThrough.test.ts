import { afterEach, expect, it, vi } from "vitest";
import type { Locator } from "@playwright/test";

import { allowPassThrough, passThroughWhileCovered } from "./panelPassThrough";
import { hideDocument } from "../../shared/test-utils/visibility";

const disposals: (() => void)[] = [];

afterEach(() => {
  for (const dispose of disposals.splice(0)) dispose();
  vi.useRealTimers();
  document.body.innerHTML = "";
});

/** A panel root in an open shadow root, allowed to pass pointer events through. */
function panel() {
  const host = document.createElement("div");
  document.body.append(host);
  const shadowRoot = host.attachShadow({ mode: "open" });
  const root = document.createElement("div");
  root.dataset.aymeInspectorRoot = "";
  shadowRoot.append(root);
  disposals.push(allowPassThrough(shadowRoot));
  return root;
}

it("lets pointer events through for the whole action while the document is hidden", async () => {
  vi.useFakeTimers();
  const root = panel();
  disposals.push(hideDocument());
  // Never asked whether it is covered: nobody uses the panel in a hidden tab.
  const target = { evaluateAll: vi.fn() } as unknown as Locator;

  const passingThrough = await passThroughWhileCovered([target], () =>
    root.hasAttribute("data-ayme-pass-through")
  );

  expect(passingThrough).toBe(true);
  expect(root.hasAttribute("data-ayme-pass-through")).toBe(false);
  expect(target.evaluateAll).not.toHaveBeenCalled();
});
