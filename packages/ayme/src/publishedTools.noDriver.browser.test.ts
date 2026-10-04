import { expect, it } from "vitest";
import { createPage } from "@ayme-dev/playwright-lite";

import { listPublishedTools } from "./publishedTools";
import { createAyme } from "./runtime";

it("lists nothing, and tells subscribers publication is unavailable, when the page has no WebMCP driver", async () => {
  // Diagnostic: this file runs without native WebMCP or the polyfill.
  expect(document.modelContext).toBeUndefined();
  const runtime = createAyme({
    pageFactory: () => createPage(),
    webMCP: { enabled: true },
  });
  const heard: string[] = [];
  const unsubscribe = runtime.webMCP.subscribe(({ state }) => {
    heard.push(state);
  });
  const stop = runtime.start();

  try {
    await expect
      .poll(() => runtime.webMCP.publicationStatus.state, { timeout: 5_000 })
      .toBe("unavailable");

    expect(heard.at(-1)).toBe("unavailable");
    expect(listPublishedTools()).toEqual([]);
  } finally {
    stop();
    unsubscribe();
  }
});
