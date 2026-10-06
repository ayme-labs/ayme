import type { Locator, Page } from "@playwright/test";
import { isJsonValue, type JsonValue } from "./contracts";
import { probePomRootState } from "./pomReachability";
import type { PageDriver, RootObservation } from "./pageDriver";

/** What a Page Object Tool answers when it runs in Node: the method's result. */
export type NodeToolResult = { result: JsonValue | null };

export type PlaywrightPageDriver = PageDriver<NodeToolResult> & {
  /** Stop watching the page and forget the binding installed in it. */
  dispose(): Promise<void>;
};

let nextBindingId = 0;

/**
 * The page driver for Node: a real Playwright `Page` driven over the protocol.
 * A locator is recognised by its shape, since Playwright's `Locator` carries
 * no brand; a root is observed through the same `probePomRootState` the
 * browser runtime uses (ADR-0019, ADR-0020); the page is watched through a
 * `MutationObserver` installed in every document the page loads, which calls
 * an exposed function; a tool runs as a plain method call and answers its
 * result. No element identity, so no Structural Refs and no collection tools.
 */
export function createPlaywrightPageDriver(page: Page): PlaywrightPageDriver {
  const binding = `__aymePageChanged${nextBindingId++}`;
  let onChange: (() => void) | undefined;
  let installed: Promise<void> | undefined;

  const install = () =>
    (installed ??= (async () => {
      await page.exposeFunction(binding, () => onChange?.());
      const script = watcherScript(binding);
      await page.addInitScript(script);
      // The document already open never ran the init script.
      await page.evaluate(script).catch(() => {});
    })());

  return {
    isLocator(value): value is Locator {
      return (
        typeof value === "object" &&
        value !== null &&
        typeof (value as Locator).count === "function" &&
        typeof (value as Locator).evaluate === "function" &&
        typeof (value as Locator).locator === "function" &&
        typeof (value as Locator).page === "function"
      );
    },

    async observeRoot(root): Promise<RootObservation> {
      const count = await root.count();
      if (count !== 1) return { count, present: false, available: false };
      const state = await probePomRootState(root);
      return { count, ...state };
    },

    watch(listener) {
      onChange = listener;
      void install();
      return () => {
        if (onChange === listener) onChange = undefined;
      };
    },

    async run(perform) {
      const value = await perform();
      return { result: isJsonValue(value) ? value : null };
    },

    async dispose() {
      onChange = undefined;
      // Playwright has no way to remove an exposed function; the binding stays
      // as a no-op until the page closes.
    },
  };
}

/**
 * Source of the in-page watcher. Written as a string, not a function, so no
 * loader helper (esbuild's `keepNames`, for one) can leak into it: the page
 * receives exactly this text.
 */
function watcherScript(binding: string) {
  return `(() => {
  const key = ${JSON.stringify(binding)};
  if (window[key + "Installed"]) return;
  window[key + "Installed"] = true;
  let scheduled = false;
  const notify = () => {
    if (scheduled) return;
    scheduled = true;
    setTimeout(() => {
      scheduled = false;
      const fn = window[key];
      if (typeof fn === "function") fn();
    }, 0);
  };
  const start = () => {
    new MutationObserver(notify).observe(document.documentElement, {
      attributes: true,
      childList: true,
      characterData: true,
      subtree: true,
    });
    for (const event of ["scroll", "resize", "transitionend", "transitioncancel", "animationend", "animationcancel"])
      window.addEventListener(event, notify, true);
    notify();
  };
  if (document.documentElement) start();
  else document.addEventListener("DOMContentLoaded", start, { once: true });
})()`;
}
