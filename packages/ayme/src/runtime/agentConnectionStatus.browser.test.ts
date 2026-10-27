import { afterEach, expect, it, vi } from "vitest";

import { createPage } from "../page-objects/infrastructure";
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
    /** Whether the session follows the stand-in. */
    followed: () => listeners.size > 0,
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
  await vi.waitFor(() => expect(client.followed()).toBe(true));

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

it("stops announcing to a listener that unsubscribed", async () => {
  const ayme = started();
  const status = getAgentConnectionStatus(ayme);
  const heard: unknown[] = [];
  const unsubscribe = status.subscribe((next) => heard.push(next));
  await vi.waitFor(() => expect(client.followed()).toBe(true));

  const before = heard.length;

  unsubscribe();
  client.set({ state: "connected" });

  expect(heard).toHaveLength(before);
});

it("says it is not connected once the session stops, and stops following the page client", async () => {
  const ayme = createAyme({ pageFactory: () => page, agentConnection: true });
  const stop = ayme.start();
  const status = getAgentConnectionStatus(ayme);
  const heard: unknown[] = [];
  status.subscribe((next) => heard.push(next));
  await vi.waitFor(() => expect(client.followed()).toBe(true));

  stop();
  expect(heard.at(-1)).toEqual({ state: "not-connected" });
  heard.length = 0;
  client.set({ state: "connected" });

  expect(client.followed()).toBe(false);
  expect(heard).toEqual([]);
});
