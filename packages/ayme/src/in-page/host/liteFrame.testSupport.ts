// The page's own runtime in a frame of the browser lane: this document's
// Playwright Lite page and the in-page module's hosts, built from source.
// Each frame is a fresh document with a realm of its own, as a Lite host
// must share its document's realm.
import { createPage, selectors } from "@ayme-dev/playwright-lite";

import { createInPageHost, registerAymeRef } from "./inPage";

export type LiteFrame = {
  page: ReturnType<typeof createPage>;
  createHost: typeof createInPageHost;
};

// Before the page, as a Playwright Lite runtime registers its engines.
await registerAymeRef(selectors);

(window as Window & { aymeLiteFrame?: LiteFrame }).aymeLiteFrame = {
  page: createPage(),
  createHost: createInPageHost,
};
