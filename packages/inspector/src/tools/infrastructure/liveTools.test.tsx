import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";

import type { Ayme, ToolInfo } from "@ayme-dev/ayme";
import {
  createInspectorContract,
  type InspectorSession,
} from "@ayme-dev/ayme/inspector";

import { createInspectorClient } from "../../shared";
import { useLiveTools, type LiveTools } from "./liveTools";
import {
  agentConnectionOf,
  appProcessToolsOf,
  asStartedAyme,
  startedAyme,
} from "../test-utils/startedAyme";

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

const jobsPeek = {
  name: "peek.node.jobs",
  description: 'Read the current values of the Peek "jobs".',
  inputSchema: { type: "object" },
};

const unmounts: (() => void)[] = [];
let session: Ayme | undefined = asStartedAyme();
let announceSession: (ayme: Ayme | undefined) => void = () => {};
let connection = agentConnectionOf();
const client = createInspectorClient(
  createInspectorContract({
    started: () => session as unknown as InspectorSession | undefined,
    subscribeToStarted: (listener) => {
      announceSession = listener;
      return () => {};
    },
    appProcessTools: appProcessToolsOf,
    connectionStatus: () => connection,
    subscribeToAgentImageRuns: () => () => {},
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
    appProcess: [],
    publication: { state: "active", message: "" },
    agentConnection: { state: "off" },
  });
});

it("gives the Agent Connection status, and follows it", async () => {
  publish([getPageContext]);
  const seen = await renderReader();

  startedAyme.agentConnection = { state: "connected", agent: "claude-code" };
  await act(async () => announce());

  expect(seen.at(-1)?.agentConnection).toEqual({
    state: "connected",
    agent: "claude-code",
  });
});

it("stops following the Agent Connection once nothing reads the tools", async () => {
  const unsubscribe = vi.fn();
  connection = {
    get: () => startedAyme.agentConnection,
    subscribe: () => unsubscribe,
  };
  await renderReader();

  for (const unmount of unmounts.splice(0)) act(unmount);

  expect(unsubscribe).toHaveBeenCalledOnce();
  connection = agentConnectionOf();
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

it("gives the App Processes' tools beside the page's, and follows them", async () => {
  publish([getPageContext]);
  const seen = await renderReader();

  startedAyme.appProcessTools.list.mockReturnValue([jobsPeek]);
  await act(async () => announce());

  expect(seen.at(-1)).toMatchObject({
    live: [getPageContext],
    appProcess: [
      {
        name: jobsPeek.name,
        // An App Process's tool says what its author wrote, to agents too.
        authorDescription: jobsPeek.description,
        agentDescription: jobsPeek.description,
        inputSchema: jobsPeek.inputSchema,
        group: "peek",
        side: "node",
      },
    ],
  });
  expect(seen.at(-1)?.appProcess[0]).not.toHaveProperty("description");
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
    appProcess: [],
    publication: {
      state: "failed",
      message: "Publication failed: a name is taken.",
    },
    agentConnection: { state: "off" },
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
    appProcess: [],
    publication: {
      state: "disposed",
      message: "No Ayme runtime session has started.",
    },
    agentConnection: { state: "off" },
  });

  session = asStartedAyme();
  await act(async () => announceSession(session));
  publish([getPageContext, addItem]);
  await act(async () => announce());

  expect(seen.at(-1)?.live).toEqual([getPageContext, addItem]);
});
