import type { Page } from "@playwright/test";
import type { PomManifest } from "./contracts";
import { createPlaywrightPageDriver } from "./playwrightPageDriver";
import { createPomRegistry, type CallerAwarePomTool } from "./pomRegistry";
import type { NodeToolResult } from "./playwrightPageDriver";

export type { PageDriver, RootObservation } from "./pageDriver";
export type { NodeToolResult } from "./playwrightPageDriver";
export type { PomManifest } from "./contracts";
export { probePomRootState } from "./pomReachability";

/** A live Page Object Tool as Node offers it: the browser's shape, a plain result. */
export type LivePageObjectTool = CallerAwarePomTool<NodeToolResult>;

export type PageObjectConstructor<T extends object = object> = new (
  page: Page
) => T;

export type LivePageObjects = {
  /**
   * Register a Page Object class under its compiled manifest (from
   * `derivePomManifests` in `@ayme-dev/unplugin-ayme`). The instance is
   * constructed with the page unless one is given. Returns its disposal.
   */
  register<T extends object>(
    PomClass: PageObjectConstructor<T>,
    manifest: PomManifest,
    instance?: T
  ): () => void;
  /** Observe every registration now. */
  probe(): Promise<void>;
  /** The live Page Object Tools, after the last probe. */
  tools(): LivePageObjectTool[];
  /** Called on every registration, disposal and changed observation. */
  subscribe(listener: () => void): () => void;
  /** Drop every registration and stop watching the page. */
  dispose(): Promise<void>;
};

/**
 * Live Page Object Tools in Node, over a real Playwright `Page`: the same
 * registry, activation rule and reachability policy as the browser runtime,
 * on the Playwright page driver. A registered Page Object's tools are live
 * while its root is present and available (or always, when it declares no
 * root), and a Page Object Child's while its own root is; the set changes
 * when the page does.
 *
 * Prototype entry. Collection tools, Settled Page waits and Change Records
 * are not available in Node yet.
 */
export function observePageObjects(page: Page): LivePageObjects {
  const driver = createPlaywrightPageDriver(page);
  const registry = createPomRegistry(driver);
  return {
    register(PomClass, manifest, instance = new PomClass(page)) {
      return registry.register(PomClass, manifest, instance).dispose;
    },
    probe: registry.probe,
    tools: registry.listTools,
    subscribe: registry.subscribe,
    async dispose() {
      registry.reset();
      await driver.dispose();
    },
  };
}
