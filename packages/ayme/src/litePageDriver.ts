import {
  isPlaywrightLiteLocator,
  resolveLocatorElements,
} from "@ayme-dev/playwright-lite/internal";
import type { Locator } from "@playwright/test";
import { AriaRefSchema } from "@ayme-dev/core/structural-observation";
import { probePomRootState } from "./pomReachability";
import { resolvePageStateRefs } from "./pageState";
import { runAction, type ActionResult } from "./actionSequence";
import { RuntimeStateError } from "./errors";
import type { PageDriver, RootObservation } from "./pageDriver";

const layoutEvents = [
  "scroll",
  "resize",
  "transitionend",
  "transitioncancel",
  "animationend",
  "animationcancel",
] as const;

/**
 * The page driver of the browser runtime: Playwright Lite inside the document.
 * Locators carry Lite's brand and resolve to elements synchronously, so a root
 * observation belongs to one element; the page is watched through a
 * MutationObserver and the layout events; a tool runs as a recorded action
 * with a Settled Page and a Change Record.
 */
export const litePageDriver: PageDriver<ActionResult> = {
  isLocator(value): value is Locator {
    return isPlaywrightLiteLocator(value);
  },

  async observeRoot(root): Promise<RootObservation> {
    const count = await root.count();
    const elements = resolveLocatorElements(root);
    const element =
      count === 1 && elements.length === 1 ? elements[0] : undefined;
    const state =
      element === undefined
        ? { present: false, available: false }
        : await probePomRootState(root);
    // The observation belongs to one element: the same one before and after.
    const current = resolveLocatorElements(root);
    const sameElement = current.length === 1 && current[0] === element;
    return {
      count,
      element: sameElement ? element : undefined,
      present: sameElement && state.present,
      available: sameElement && state.available,
    };
  },

  watch(onChange) {
    const mutationObserver = new MutationObserver(onChange);
    mutationObserver.observe(document.documentElement, {
      attributes: true,
      childList: true,
      characterData: true,
      subtree: true,
    });
    const observedWindow = document.defaultView;
    for (const event of layoutEvents)
      observedWindow?.addEventListener(event, onChange, true);
    return () => {
      for (const event of layoutEvents)
        observedWindow?.removeEventListener(event, onChange, true);
      mutationObserver.disconnect();
    };
  },

  run(perform, call, caller) {
    // A tool may be called without the caller ever having read the page; the
    // Change Record then starts from the page right before the action.
    return runAction(requireCurrentDocument(), caller, call, perform);
  },

  locatorElements(locator) {
    return resolveLocatorElements(locator);
  },

  async resolveRef(ref) {
    const resolutions = await resolvePageStateRefs(
      document,
      AriaRefSchema.parse(ref)
    );
    const resolution = resolutions[0];
    if (!resolution || resolution.status === "unresolved")
      return { reason: resolution?.reason ?? "unknown-ref" };
    return { element: resolution.node.element };
  },
};

function requireCurrentDocument(): Document {
  if (typeof document === "undefined")
    throw new RuntimeStateError(
      "POM tool execution requires a browser Document."
    );
  return document;
}
