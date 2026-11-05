// The page's own runtime in a frame of the browser lane: this document's
// Playwright Lite page and the in-page module's hosts, built from source.
// Each frame is a fresh document with a realm of its own, as a Lite host
// must share its document's realm.
import { createPage } from "@ayme-dev/playwright-lite";

import { createInPageHost } from "./inPage";

export type LiteFrame = {
  page: ReturnType<typeof createPage>;
  createHost: typeof createInPageHost;
};

(window as Window & { aymeLiteFrame?: LiteFrame }).aymeLiteFrame = {
  page: createPage(),
  createHost: createInPageHost,
};
