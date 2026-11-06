import { afterEach, expect, it, vi } from "vitest";
import { createPage } from "@ayme-dev/playwright-lite";
import type { Locator, Page } from "@playwright/test";

import { INSPECTOR_HIT_TEST_THROUGH_ATTRIBUTE } from "../../shared";
import { demoFeedback, passThroughWhileCovered } from "./demoFeedback";

// Component tests: the runtime letting a pointer action through to a page
// element the Inspector's panel covers, on playwright-lite, with a stand-in
// Inspector host.

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
  document.body.append(button, host);
  cleanups.push(() => {
    button.remove();
    host.remove();
  });
  return { host };
}

/**
 * Whether the host lets pointer events through while the action runs: the
 * action waits up to a second for it.
 */
async function passesThroughDuringAction(host: Element) {
  return await passThroughWhileCovered(
    [page.getByRole("button", { name: "Add item" })],
    async () => {
      for (let waited = 0; waited < 1000; waited += 25) {
        if (host.hasAttribute(INSPECTOR_HIT_TEST_THROUGH_ATTRIBUTE))
          return true;
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      return false;
    }
  );
}

it("lets the action through while the panel covers its target", async () => {
  const { host } = setUp({ covering: true });

  expect(await passesThroughDuringAction(host)).toBe(true);
  expect(host.hasAttribute(INSPECTOR_HIT_TEST_THROUGH_ATTRIBUTE)).toBe(false);
});

it("keeps taking pointer events while the target is clear of the panel", async () => {
  const { host } = setUp({ covering: false });

  expect(await passesThroughDuringAction(host)).toBe(false);
});

it("costs a call nothing while no panel is mounted", async () => {
  const raw = createPage();
  const button = raw.getByRole("button", { name: "Add item" });
  const evaluateAll = vi.spyOn(Object.getPrototypeOf(button), "evaluateAll");
  const click = vi.spyOn(Object.getPrototypeOf(button), "click");
  const paged = demoFeedback(raw as unknown as Page, () => ({}));
  const button2 = document.createElement("button");
  button2.textContent = "Add item";
  document.body.append(button2);
  cleanups.push(() => button2.remove());

  const locator: Locator = paged.getByRole("button", { name: "Add item" });
  const result = locator.click();

  // The call is the Page's own: no wrapper in between, no hit-test.
  expect(result).toBeInstanceOf(Promise);
  await result;
  expect(click).toHaveBeenCalledOnce();
  expect(evaluateAll).not.toHaveBeenCalled();
});
