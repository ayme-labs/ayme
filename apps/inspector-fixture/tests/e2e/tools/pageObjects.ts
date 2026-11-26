import { fileURLToPath } from "node:url";

import {
  directPageObjects,
  isNotAvailable,
  serveProjectTools,
  staleNotes,
  type Build,
} from "@ayme-dev/e2e-tools";
import type { Browser, WebApp } from "@e2e-dev/web";
import type { Screen } from "e2e";
import type { DefinedTool } from "e2e/agent";

import { Inspector } from "../pom/Inspector";
import { Tab } from "../tab";

// The entry of the Page Object study's third arm: the Page Objects of the
// e2e suite (the second arm), offered as e2e config tools by
// `directPageObjects` from `@ayme-dev/e2e-tools`. It reads the default
// export's array from this file's source, so it stays written as one.
export default [Inspector];

/**
 * Builds a listed class on the Inspector's tab, as `openFixture` does for a
 * test: in the external placement the tab `ayme mcp` serves, which is off
 * the app's origin; otherwise the tab in front.
 */
export const build: Build = async (PageObject, fixtures) => {
  const browser = fixtures.browser as Browser;
  const appOrigin = new URL((fixtures.app as WebApp).baseUrl).origin;
  const tabs = browser.tabs().filter((tab) => !tab.isClosed());
  let inspectorTab = tabs.find((tab) => tab.isActive());
  for (const tab of tabs) {
    const url = new URL(await tab.url());
    if (url.protocol.startsWith("http") && url.origin !== appOrigin)
      inspectorTab = tab;
  }
  if (!inspectorTab) throw new Error("No browser tab is active.");
  return new (PageObject as new (tab: Tab) => object)(
    new Tab(fixtures.screen as Screen, browser, inspectorTab)
  );
};

/** The tools, one per action of the listed classes, and what they can tell of the screen now. */
export const pageObjects = directPageObjects({
  entry: fileURLToPath(import.meta.url),
  build,
});

/**
 * The tools as arm 3 serves its agent: the list holds the actions that can
 * run on the screen now; a call that failed on a stale Page Object, or any
 * replayed call that failed, puts its action out of use for the test; and
 * each failed call leaves a note in `staleDir`.
 */
export function servedTools(
  staleDir: string,
  tools: Record<string, DefinedTool> = pageObjects.projectTools()
) {
  return serveProjectTools(tools, {
    onFailure: staleNotes(staleDir, (tool) => pageObjects.sourceOf(tool)),
    hidden: async (tool) => (await pageObjects.ruledOutNow(tool)) !== undefined,
    dropAfterFailure: (failure) =>
      failure.during === "replay" || !isNotAvailable(failure.error),
  });
}
