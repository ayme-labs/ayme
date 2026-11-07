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

// Playwright's overlay keeps its shadow root closed outside its own tests; the
// contract reads the highlight boxes it draws, so this frame opens it.
const attachShadow = Element.prototype.attachShadow;
Element.prototype.attachShadow = function (init) {
  return attachShadow.call(
    this,
    this.localName === "x-pw-glass" ? { ...init, mode: "open" } : init
  );
};

// Before the page, as a Playwright Lite runtime registers its engines.
await registerAymeRef(selectors);

(window as Window & { aymeLiteFrame?: LiteFrame }).aymeLiteFrame = {
  page: createPage(),
  createHost: createInPageHost,
};
