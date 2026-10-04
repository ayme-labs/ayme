import type { Selectors } from "@playwright/test";

import { INSPECTOR_SHADOW_ROOT_KEY } from "../../shared";

/**
 * The Playwright selector engine that reaches into the Inspector's closed
 * shadow root. `ayme-inspector=<css>` matches CSS inside the root, which
 * Playwright's own engines cannot see. The engine runs in the page, so it is
 * self-contained and reads the root the mount exposes for tests.
 */
export const INSPECTOR_SELECTOR_ENGINE = "ayme-inspector";

function createInspectorEngine(key: string) {
  const inspectorRoots = (scope: Element | Document) => {
    const hosts = [...scope.querySelectorAll("[data-ayme-inspector-host]")];
    if (scope instanceof Element && scope.matches("[data-ayme-inspector-host]"))
      hosts.unshift(scope);
    return hosts.flatMap((host) => {
      const root = (host as unknown as Record<symbol, ShadowRoot | undefined>)[
        Symbol.for(key)
      ];
      return root ? [root] : [];
    });
  };
  return {
    query(scope: Element | Document, selector: string) {
      for (const root of inspectorRoots(scope)) {
        const match = root.querySelector(selector);
        if (match) return match;
      }
      return null;
    },
    queryAll(scope: Element | Document, selector: string) {
      return inspectorRoots(scope).flatMap((root) => [
        ...root.querySelectorAll(selector),
      ]);
    },
  };
}

/**
 * Registers the `ayme-inspector` selector engine with Playwright. Call it
 * with `@playwright/test`'s `selectors` before the test's page is created,
 * for example in `test.beforeAll`. Registering twice is harmless.
 */
export async function registerInspectorSelectors(selectors: Selectors) {
  try {
    await selectors.register(INSPECTOR_SELECTOR_ENGINE, {
      content: `(${createInspectorEngine.toString()})(${JSON.stringify(INSPECTOR_SHADOW_ROOT_KEY)})`,
    });
  } catch (error) {
    if (!String(error).includes("already registered")) throw error;
  }
}
