import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";

import type { Ayme, ToolInfo } from "@ayme-dev/ayme";
import {
  getStartedAyme,
  subscribeToStartedAyme,
} from "@ayme-dev/ayme/internal";

import { useLiveTools, type LiveTools } from "./liveTools";
import { asStartedAyme, startedAyme } from "../test-utils/startedAyme";

// Unit tests: the Inspector's one source of the tools the panel can run, over
// a stand-in started session that the test changes and announces.
vi.mock("@ayme-dev/ayme/internal", () => ({
  getStartedAyme: vi.fn(),
  subscribeToStartedAyme: vi.fn(),
}));

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const addItem: ToolInfo = {
  name: "ListPage.addItem",
  description: "Add an item to the list.",
  inputSchema: { type: "object" },
  group: "pageObject",
};
const getPageContext: ToolInfo = {
  name: "snapshot",
  description: "Read the page.",
  inputSchema: { type: "object" },
  group: "agent",
};

const unmounts: (() => void)[] = [];
let session: Ayme | undefined = asStartedAyme();
let announceSession: (ayme: Ayme | undefined) => void = () => {};
vi.mocked(getStartedAyme).mockImplementation(() => session);
vi.mocked(subscribeToStartedAyme).mockImplementation((listener) => {
  announceSession = listener;
  return () => {};
});

afterEach(() => {
  for (const unmount of unmounts.splice(0)) act(unmount);
  startedAyme.reset();
  session = asStartedAyme();
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
  tools: readonly ToolInfo[],
  state: "active" | "failed" = "active",
  message = ""
) {
  startedAyme.tools.list.mockReturnValue(tools);
  startedAyme.webMCP.publicationStatus = { state, message };
}

const announce = () => startedAyme.announce();

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

it("gives no tools while no session is started, and follows the next one", () => {
  session = undefined;
  publish([getPageContext]);
  const seen = renderReader();
  expect(seen.at(-1)).toEqual({
    live: [],
    publication: {
      state: "disposed",
      message: "No Ayme runtime session has started.",
    },
  });

  session = asStartedAyme();
  act(() => announceSession(session));
  publish([getPageContext, addItem]);
  act(() => announce());

  expect(seen.at(-1)?.live).toEqual([getPageContext, addItem]);
});
