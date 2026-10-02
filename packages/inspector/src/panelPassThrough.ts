import type { Locator } from "@playwright/test";

/*
 * Lets the runtime's pointer actions reach page elements under the panel
 * (#272). Playwright Lite hit-tests an action's target and refuses it while
 * the Inspector host is what the pointer meets there. When that happens, the
 * Inspector's shadow roots stop taking pointer events until the action ends.
 * The toggle stays inside the closed shadow roots, out of the page's sight.
 */

// The locator actions Playwright Lite hit-tests.
const pointerActions = new Set<string | symbol>([
  "check",
  "click",
  "dblclick",
  "dragTo",
  "hover",
  "setChecked",
  "tap",
  "uncheck",
]);
const hostSelector = "[data-ayme-inspector-host]";
// Below Playwright Lite's 50ms hit-target retry, so the next retry lands.
const coverPollMs = 25;

const roots = new Set<ShadowRoot>();
let passThroughSheet: CSSStyleSheet | undefined;
let holds = 0;

/** Whether this locator method is an action Playwright Lite hit-tests. */
export function isPointerAction(property: string | symbol) {
  return pointerActions.has(property);
}

/** Lets pointer actions pass through this shadow root's panel. */
export function allowPassThrough(root: ShadowRoot) {
  roots.add(root);
  return () => {
    roots.delete(root);
    if (passThroughSheet) setPassThrough(root, false);
  };
}

/**
 * Runs a locator action. When it is a pointer action and its target's centre
 * comes under the panel while it runs, the panel lets pointer events through
 * until it ends. Not re-checked once on: the same hit-test then reaches the
 * page element.
 */
export async function passThroughWhileCovered<T>(
  property: string | symbol,
  locator: Locator,
  action: () => T
): Promise<Awaited<T>> {
  if (roots.size === 0 || !isPointerAction(property)) return await action();

  let done = false;
  let held = false;
  void (async () => {
    while (!done) {
      const covered = await locator
        .evaluateAll(isUnderInspector, hostSelector)
        .catch(() => false);
      if (done) return;
      if (covered) {
        hold();
        held = true;
        return;
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

function isUnderInspector(elements: Element[], hostSelector: string) {
  return elements.some((element) => {
    const box = element.getBoundingClientRect();
    if (!box.width || !box.height) return false;
    const hit = element.ownerDocument.elementFromPoint(
      box.left + box.width / 2,
      box.top + box.height / 2
    );
    return hit?.matches(hostSelector) ?? false;
  });
}

function hold() {
  holds += 1;
  if (holds === 1) for (const root of roots) setPassThrough(root, true);
}

function release() {
  holds -= 1;
  if (holds === 0) for (const root of roots) setPassThrough(root, false);
}

function setPassThrough(root: ShadowRoot, on: boolean) {
  if (!passThroughSheet) {
    passThroughSheet = new CSSStyleSheet();
    passThroughSheet.replaceSync("* { pointer-events: none !important; }");
  }
  const others = root.adoptedStyleSheets.filter(
    (sheet) => sheet !== passThroughSheet
  );
  root.adoptedStyleSheets = on ? [...others, passThroughSheet] : others;
}
