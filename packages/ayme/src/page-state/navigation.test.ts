// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import {
  MonotonicTimeMsSchema,
  PageIdSchema,
} from "@ayme-dev/core/structural-observation";
import { InteractionHistory } from "./interactionHistory";
import { startNavigation, watchSameDocumentNavigations } from "./navigation";

let now = 0;
const clock = { now: () => MonotonicTimeMsSchema.parse(++now) };

/** A history of `document` told of its navigations, as its session's is. */
function watched(): InteractionHistory {
  const history = new InteractionHistory({
    pageId: PageIdSchema.parse("document_1"),
    url: document.URL,
    clock,
  });
  watchSameDocumentNavigations(window, () =>
    history.recordNavigation(document.URL)
  );
  return history;
}

describe("InteractionHistory without the Navigation API", () => {
  it("records a Visit per pushState, replaceState and popstate route change", () => {
    expect("navigation" in window).toBe(false);
    const history = watched();
    const urls = () =>
      history.observations.getVisits().map((visit) => visit.urls);

    window.history.pushState(null, "", "/orders");
    window.history.replaceState(null, "", "/customers");
    window.history.pushState(null, "", "/customers#top");
    window.dispatchEvent(new PopStateEvent("popstate"));

    expect(urls()).toEqual([
      ["http://localhost:3000/"],
      ["http://localhost:3000/orders"],
      [
        "http://localhost:3000/customers",
        "http://localhost:3000/customers#top",
      ],
    ]);
  });

  it("records a direct fragment navigation in the current Visit", async () => {
    const history = watched();
    const lastUrl = () => history.observations.getVisits().at(-1)!.urls.at(-1);

    // Assigning location.hash, as a fragment link does.
    const hashChanged = new Promise((resolve) =>
      window.addEventListener("hashchange", resolve, { once: true })
    );
    window.location.hash = "details";
    await hashChanged;
    expect(lastUrl()).toBe("http://localhost:3000/customers#details");

    // A fragment navigation that fires only hashchange: the URL changes
    // through the unwrapped History method, then the event arrives.
    History.prototype.replaceState.call(window.history, null, "", "#reviews");
    window.dispatchEvent(new HashChangeEvent("hashchange"));
    expect(lastUrl()).toBe("http://localhost:3000/customers#reviews");
    expect(history.observations.getVisits()).toHaveLength(1);
  });
});

describe("startNavigation without the Navigation API", () => {
  it("waits for the browser Page's call to end", async () => {
    // jsdom's window has no `navigation`, as in a browser without the API.
    let end!: () => void;
    const started = vi.fn();
    void startNavigation(
      document,
      () => new Promise<void>((resolve) => (end = resolve))
    ).then(started);
    await Promise.resolve();
    await Promise.resolve();
    expect(started).not.toHaveBeenCalled();

    end();
    await vi.waitFor(() => expect(started).toHaveBeenCalledOnce());
  });
});
