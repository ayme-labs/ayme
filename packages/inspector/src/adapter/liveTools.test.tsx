import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";

import type { PublishedToolInfo } from "@ayme-dev/ayme/internal";
import {
  getPublicationStatus,
  listLiveTools,
  subscribeToPublishedTools,
} from "@ayme-dev/ayme/internal";

import { useLiveTools, type LiveTools } from "./liveTools";

// Unit tests: the adapter's one source of the tools the panel can run, over
// a stubbed runtime read model that the test changes and announces.
vi.mock("@ayme-dev/ayme/internal", () => ({
  getPublicationStatus: vi.fn(),
  listLiveTools: vi.fn(),
  subscribeToPublishedTools: vi.fn(),
}));

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const addItem: PublishedToolInfo = {
  name: "ListPage.addItem",
  description: "Add an item to the list.",
  inputSchema: { type: "object" },
  group: "pageObject",
};
const getPageContext: PublishedToolInfo = {
  name: "snapshot",
  description: "Read the page.",
  inputSchema: { type: "object" },
  group: "agent",
};

let announce = () => {};
const unmounts: (() => void)[] = [];

afterEach(() => {
  for (const unmount of unmounts.splice(0)) act(unmount);
  vi.clearAllMocks();
});

/** Renders a component that reads the live tools; returns each read. */
function renderReader() {
  const seen: LiveTools[] = [];
  function Reader() {
    seen.push(useLiveTools());
    return null;
  }
  const root = createRoot(document.createElement("div"));
  act(() => root.render(<Reader />));
  unmounts.push(() => root.unmount());
  return seen;
}

function publish(
  tools: readonly PublishedToolInfo[],
  state: "active" | "failed" = "active",
  message = ""
) {
  vi.mocked(listLiveTools).mockReturnValue(tools);
  vi.mocked(getPublicationStatus).mockReturnValue({ state, message });
}

vi.mocked(subscribeToPublishedTools).mockImplementation((subscriber) => {
  announce = subscriber;
  return () => {};
});

it("gives the live tools and the publication status", () => {
  publish([getPageContext, addItem]);

  const seen = renderReader();

  expect(seen.at(-1)).toEqual({
    live: [getPageContext, addItem],
    publication: { state: "active", message: "" },
  });
});

it("keeps the live tools when publication fails, with its error", () => {
  publish([getPageContext]);
  const seen = renderReader();

  publish(
    [getPageContext, addItem],
    "failed",
    "Publication failed: a name is taken."
  );
  act(() => announce());

  expect(seen.at(-1)).toEqual({
    live: [getPageContext, addItem],
    publication: {
      state: "failed",
      message: "Publication failed: a name is taken.",
    },
  });
});

it("hands out the same value until something changes", () => {
  publish([getPageContext]);
  const seen = renderReader();

  act(() => announce());

  expect(new Set(seen).size).toBe(1);
});
