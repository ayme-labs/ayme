import { afterAll, afterEach, expect, it } from "vitest";

import { createPage } from "../../page-objects/infrastructure";
import { createAyme } from "../../runtime";
import { getInteractionHistory } from "./pageState";

// Its own file: the session must start on this document before its in-page
// module is bound, and each browser test file gets its own document.

const LOADED_URL = location.href;
const at = (path: string) => new URL(path, LOADED_URL).href;
const visits = () =>
  getInteractionHistory(document)
    .observations.getVisits()
    .map(({ urls }) => urls);

let stop = () => {};

afterEach(() => stop());

afterAll(() => {
  window.history.replaceState(null, "", LOADED_URL);
});

it("records a route change made before the document's module was bound, once it is", async () => {
  stop = createAyme({ pageFactory: () => createPage() }).start();
  // In the same task as the start, before the module is installed.
  window.history.pushState(null, "", "/early");

  await expect.poll(visits).toEqual([[LOADED_URL], [at("/early")]]);
});

it("records a change of the query alone in the current Visit", async () => {
  stop = createAyme({ pageFactory: () => createPage() }).start();
  window.history.pushState(null, "", "/search");
  await expect.poll(() => visits().length).toBe(3);

  window.history.pushState(null, "", "/search?q=milk");
  window.history.replaceState(null, "", "/search?q=eggs#results");

  await expect
    .poll(visits)
    .toEqual([
      [LOADED_URL],
      [at("/early")],
      [at("/search"), at("/search?q=milk"), at("/search?q=eggs#results")],
    ]);
});
