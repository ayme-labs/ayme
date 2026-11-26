import type { Build } from "@ayme-dev/e2e-tools";
import type { Browser } from "@e2e-dev/web";
import type { Screen } from "e2e";

import { Inspector } from "../pom/Inspector";
import { Tab } from "../tab";

// The entry of the Page Object study's third arm: the Page Objects of the
// e2e suite (the second arm), offered as e2e config tools by
// `directPageObjects` from `@ayme-dev/e2e-tools`. It reads the default
// export's array from this file's source, so it stays written as one.
export default [Inspector];

/** Builds a listed class on the tab in front, as `openFixture` does for a test. */
export const build: Build = (PageObject, { screen, browser }) => {
  const tabs = (browser as Browser).tabs();
  const active = tabs.find((tab) => tab.isActive());
  if (!active) throw new Error("No browser tab is active.");
  return new (PageObject as new (tab: Tab) => object)(
    new Tab(screen as Screen, browser as Browser, active)
  );
};
