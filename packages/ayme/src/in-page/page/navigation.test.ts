// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { watchSameDocumentNavigations } from "./navigation";

// jsdom's window has no `navigation`, as in a browser without the
// Navigation API; the document's module watches it once, at install.
const heard: string[] = [];
watchSameDocumentNavigations(window, () => heard.push(document.URL));

describe("the navigation watcher without the Navigation API", () => {
  it("hears each pushState, replaceState and popstate route change", () => {
    expect("navigation" in window).toBe(false);
    heard.length = 0;

    window.history.pushState(null, "", "/orders");
    window.history.replaceState(null, "", "/customers");
    window.history.pushState(null, "", "/customers#top");
    window.dispatchEvent(new PopStateEvent("popstate"));

    expect(heard).toEqual([
      "http://localhost:3000/orders",
      "http://localhost:3000/customers",
      "http://localhost:3000/customers#top",
      "http://localhost:3000/customers#top",
    ]);
  });

  it("hears a direct fragment navigation", async () => {
    heard.length = 0;

    // Assigning location.hash, as a fragment link does.
    const hashChanged = new Promise((resolve) =>
      window.addEventListener("hashchange", resolve, { once: true })
    );
    window.location.hash = "details";
    await hashChanged;
    // A fragment navigation that fires only hashchange: the URL changes
    // through the unwrapped History method, then the event arrives.
    History.prototype.replaceState.call(window.history, null, "", "#reviews");
    window.dispatchEvent(new HashChangeEvent("hashchange"));

    // Assigning the hash fires popstate and hashchange both; a Visit
    // records a URL reported twice once.
    expect(new Set(heard)).toEqual(
      new Set([
        "http://localhost:3000/customers#details",
        "http://localhost:3000/customers#reviews",
      ])
    );
  });
});
