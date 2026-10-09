import type { Locator } from "@playwright/test";

/*
 * Lets the runtime's pointer actions reach page elements under the panel.
 * Playwright Lite hit-tests an action's target and refuses it while
 * the Inspector host is what the pointer meets there. When that happens, the
 * Inspector's shadow root stops taking pointer events until the action ends.
 * The toggle stays inside the closed shadow root, out of the page's sight.
 */

const hostSelector = "[data-ayme-inspector-host]";
// Playwright Lite retries a failed hit-target check after 0, 20, 100, 100,
// then 500ms; polling at 25ms keeps detection ahead of the early retries.
const coverPollMs = 25;

let root: ShadowRoot | undefined;
let holds = 0;

/** Lets pointer actions pass through the panel in this shadow root. */
export function allowPassThrough(shadowRoot: ShadowRoot) {
  root = shadowRoot;
  if (holds > 0) setPassThrough(true);
  return () => {
    setPassThrough(false);
    if (root === shadowRoot) root = undefined;
  };
}

/**
 * Runs a pointer action. When one of its targets comes under the panel while
 * it runs, the panel lets pointer events through until it ends. Not
 * re-checked once on: the same hit-test then reaches the page element.
 */
export async function passThroughWhileCovered<T>(
  targets: readonly Locator[],
  action: () => T
): Promise<Awaited<T>> {
  if (!root || targets.length === 0) return await action();

  let done = false;
  let held = false;
  void (async () => {
    while (!done) {
      for (const target of targets) {
        const covered = await target
          .evaluateAll(isUnderInspector, hostSelector)
          .catch(() => false);
        if (done) return;
        if (covered) {
          hold();
          held = true;
          return;
        }
      }
      await new Promise((resolve) => setTimeout(resolve, coverPollMs));
    }
  })();
  try {
    return await action();
  } finally {
    done = true;
    if (held) release();
  }
}

// Whether the Inspector host is what the pointer meets at an element's
// action point: the centre of its first client rect inside the viewport, as
// Playwright Lite picks it. An element of the panel itself is never under it:
// a page that dogfoods the Inspector drives the panel through these actions.
// Stryker disable all: evaluateAll serializes this function into the page, where Stryker's instrumented copy can't run.
function isUnderInspector(elements: Element[], hostSelector: string) {
  return elements.some((element) => {
    const rootNode = element.getRootNode() as Partial<ShadowRoot>;
    if (rootNode.host?.matches(hostSelector)) return false;
    const document = element.ownerDocument;
    const width = document.documentElement.clientWidth;
    const height = document.documentElement.clientHeight;
    for (const rect of element.getClientRects()) {
      const left = Math.max(0, rect.left);
      const right = Math.min(width, rect.right);
      const top = Math.max(0, rect.top);
      const bottom = Math.min(height, rect.bottom);
      if (right <= left || bottom <= top) continue;
      if ((right - left) * (bottom - top) <= 0.99) continue;
      const hit = document.elementFromPoint(
        (left + right) / 2,
        (top + bottom) / 2
      );
      return hit?.matches(hostSelector) ?? false;
    }
    return false;
  });
}
// Stryker restore all

function hold() {
  holds += 1;
  if (holds === 1) setPassThrough(true);
}

function release() {
  holds -= 1;
  if (holds === 0) setPassThrough(false);
}

function setPassThrough(on: boolean) {
  root
    ?.querySelector("[data-ayme-inspector-root]")
    ?.toggleAttribute("data-ayme-pass-through", on);
}
