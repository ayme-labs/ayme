import { afterEach, expect, it, vi } from "vitest";

import { createPage } from "./browserPage";
import { getAgentConnectionStatus } from "./agentConnectionStatus";
import { createAyme, type AymeOptions } from "./runtime";

// Runtime seam: whether the started session's page is connected to a
// coding agent, as its page client reports it, for the Inspector.

type Status = { state: string; reason?: string; agent?: string };

// The page client loads as a stand-in whose status the test sets.
const client = vi.hoisted(() => {
  let status: Status = { state: "not-connected" };
  const listeners = new Set<(status: Status) => void>();
  return {
    set(next: Status) {
      status = next;
      for (const listener of listeners) listener(status);
    },
    status: {
      get: () => status,
      subscribe(listener: (status: Status) => void) {
        listeners.add(listener);
        return () => void listeners.delete(listener);
      },
    },
    reset() {
      status = { state: "not-connected" };
      listeners.clear();
    },
  };
});
vi.mock("./agentConnection", () => ({
  loadAgentConnection: async () => ({
    startAgentConnection: () => ({
      dispose() {},
      processTools: {
        list: () => [],
        subscribe: () => () => {},
        run: async () => undefined,
      },
      status: client.status,
    }),
  }),
  loadProcessConnection: async () => ({
    startAgentConnection: () => ({ dispose() {} }),
  }),
}));

const page = createPage();
let cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.reverse()) cleanup();
  cleanups = [];
  client.reset();
});

function started(options: AymeOptions = { agentConnection: true }) {
  const ayme = createAyme({ pageFactory: () => page, ...options });
  cleanups.push(ayme.start());
  return ayme;
}

it("is off without the agentConnection option", () => {
  const ayme = started({});

  expect(getAgentConnectionStatus(ayme).get()).toEqual({ state: "off" });
});

it("follows the page client's status, and announces each change", async () => {
  const ayme = started();
  const status = getAgentConnectionStatus(ayme);
  const heard: unknown[] = [];
  status.subscribe((next) => heard.push(next));
  await vi.waitFor(() => expect(heard).toHaveLength(0));

  client.set({ state: "connected", agent: "claude-code" });

  await vi.waitFor(() =>
    expect(status.get()).toEqual({ state: "connected", agent: "claude-code" })
  );
  expect(heard.at(-1)).toEqual({ state: "connected", agent: "claude-code" });
});

it("is not connected before the page client loads, and once the session stops", async () => {
  const ayme = createAyme({ pageFactory: () => page, agentConnection: true });
  const stop = ayme.start();
  const status = getAgentConnectionStatus(ayme);
  expect(status.get()).toEqual({ state: "not-connected" });
  client.set({ state: "connected" });
  await vi.waitFor(() => expect(status.get()).toEqual({ state: "connected" }));

  stop();

  expect(status.get()).toEqual({ state: "not-connected" });
});
