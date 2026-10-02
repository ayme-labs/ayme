import { afterEach, expect, it, vi } from "vitest";
import { createPage } from "@ayme-dev/playwright-lite";

import {
  getPublicationStatus,
  listPublishedTools,
  subscribeToPublishedTools,
} from "./publishedTools";
import { createRuntimeSession } from "./runtime";

afterEach(() => {
  vi.unstubAllGlobals();
});

it("lists nothing, and tells subscribers publication is unavailable, when the page has no WebMCP driver", async () => {
  // Diagnostic: this file runs without native WebMCP or the polyfill.
  expect(document.modelContext).toBeUndefined();
  vi.stubGlobal("__AYME_WEBMCP_PUBLISH__", true);
  const runtime = createRuntimeSession({ page: () => createPage() });
  const heard: string[] = [];
  const unsubscribe = subscribeToPublishedTools(() => {
    heard.push(getPublicationStatus().state);
  });
  const stop = runtime.start();

  try {
    await expect
      .poll(() => runtime.getSnapshot().state, { timeout: 5_000 })
      .toBe("unavailable");

    expect(heard.at(-1)).toBe("unavailable");
    expect(listPublishedTools()).toEqual([]);
  } finally {
    stop();
    unsubscribe();
  }
});
