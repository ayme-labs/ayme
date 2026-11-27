import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it } from "vitest";

import type { Ayme, ToolInfo } from "@ayme-dev/ayme";
import {
  createInspectorContract,
  type InspectorSession,
} from "@ayme-dev/ayme/internal";

import { createInspectorClient } from "../../shared/infrastructure";
import { useLiveTools, type LiveTools } from "./liveTools";
import { asStartedAyme, startedAyme } from "../../../testing/tools/startedAyme";

// Unit tests: the Inspector's one source of the tools the panel can run, read
// through the contract client over a stand-in started session that the test
// changes and announces.

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const addItem: ToolInfo = {
  name: "ListPage.addItem",
  authorDescription: "Add an item to the list.",
  agentDescription: "Add an item to the list.",
  inputSchema: { type: "object" },
  group: "pageObject",
  available: true,
};
const getPageContext: ToolInfo = {
  name: "snapshot",
  authorDescription: "Read the page.",
  agentDescription: "Read the page.",
  inputSchema: { type: "object" },
  group: "agent",
  available: true,
};

const unmounts: (() => void)[] = [];
let session: Ayme | undefined = asStartedAyme();
let announceSession: (ayme: Ayme | undefined) => void = () => {};
const client = createInspectorClient(
  createInspectorContract({
    started: () => session as unknown as InspectorSession | undefined,
    subscribeToStarted: (listener) => {
      announceSession = listener;
      return () => {};
    },
    highlights: { set: async () => {} },
    pick: async () => undefined,
    registry: {
      pageObjects: () => [],
      pomDefinitions: () => [],
      subscribe: () => () => {},
    },
    look: async () => {
      throw new Error("No look in this test.");
    },
    pomDefinitionText: () => "",
    recordedPageState: async () => undefined,
    demo: () => {},
  })
);

afterEach(() => {
  for (const unmount of unmounts.splice(0)) act(unmount);
  startedAyme.reset();
  session = asStartedAyme();
});

/** Renders a component that reads the live tools; returns each read. */
async function renderReader() {
  const seen: LiveTools[] = [];
  function Reader() {
    seen.push(useLiveTools(client));
    return null;
  }
  const root = createRoot(document.createElement("div"));
  await act(async () => root.render(<Reader />));
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

it("gives the live tools and the publication status", async () => {
  publish([getPageContext, addItem]);

  const seen = await renderReader();

  expect(seen.at(-1)).toEqual({
    live: [getPageContext, addItem],
    publication: { state: "active", message: "" },
  });
});

it("follows a change of the publication status alone", async () => {
  publish([getPageContext]);
  const seen = await renderReader();

  startedAyme.webMCP.publicationStatus = {
    state: "unavailable",
    message: "The WebMCP driver is unavailable.",
  };
  await act(async () => announce());

  expect(seen.at(-1)?.publication.state).toBe("unavailable");
});

it("keeps a listed tool that is unavailable, with its reason", async () => {
  const clear: ToolInfo = {
    ...addItem,
    name: "ListPage.clear",
    available: false,
    reason: "Nothing to clear",
  };
  publish([getPageContext, clear]);

  const seen = await renderReader();

  expect(seen.at(-1)?.live).toEqual([getPageContext, clear]);
});

it("keeps the live tools when publication fails, with its error", async () => {
  publish([getPageContext]);
  const seen = await renderReader();

  publish(
    [getPageContext, addItem],
    "failed",
    "Publication failed: a name is taken."
  );
  await act(async () => announce());

  expect(seen.at(-1)).toEqual({
    live: [getPageContext, addItem],
    publication: {
      state: "failed",
      message: "Publication failed: a name is taken.",
    },
  });
});

it("hands out the same value until something changes", async () => {
  publish([getPageContext]);
  const seen = await renderReader();
  const loaded = seen.at(-1);

  await act(async () => announce());

  expect(seen.at(-1)).toBe(loaded);
});

it("gives no tools while no session is started, and follows the next one", async () => {
  session = undefined;
  publish([getPageContext]);
  const seen = await renderReader();
  expect(seen.at(-1)).toEqual({
    live: [],
    publication: {
      state: "disposed",
      message: "No ayme runtime session has started.",
    },
  });

  session = asStartedAyme();
  await act(async () => announceSession(session));
  publish([getPageContext, addItem]);
  await act(async () => announce());

  expect(seen.at(-1)?.live).toEqual([getPageContext, addItem]);
});
