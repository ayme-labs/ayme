import { afterEach, describe, expect, it, vi } from "vitest";

import { createAyme, type Ayme, type AymeOptions } from "./runtime";

// Runtime object seam in a Node process of the app (an App Process): no
// window and no document. `start()` hands `ayme` to the App Process's side
// of the Agent Connection, which this test records in place of the real
// one, which would scan for an agent's Ayme MCP server.

const processConnections = vi.hoisted(
  () =>
    [] as {
      ayme: Pick<Ayme, "tools">;
      options: unknown;
      disposed: boolean;
    }[]
);
vi.mock("./agentConnection", () => ({
  loadAgentConnection: async () => {
    throw new Error("A Node process never loads the page client.");
  },
  loadProcessConnection: async () => ({
    startAgentConnection(ayme: Pick<Ayme, "tools">, options: unknown) {
      const connection = { ayme, options, disposed: false };
      processConnections.push(connection);
      return {
        dispose() {
          connection.disposed = true;
        },
      };
    },
  }),
}));

let cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.reverse()) cleanup();
  cleanups = [];
  processConnections.length = 0;
});

function started(options: AymeOptions = { agentConnection: true }) {
  const ayme = createAyme(options);
  cleanups.push(ayme.start());
  return ayme;
}

function peek(ayme: Ayme, ...args: Parameters<Ayme["peek"]>) {
  cleanups.push(ayme.peek(...args));
}

/** Lets the lazily loaded connection start. */
const loaded = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("createAyme in an App Process", () => {
  it("starts without a page and hands the session to the App Process's connection", async () => {
    const ayme = started();

    await loaded();

    expect(processConnections).toHaveLength(1);
    expect(processConnections[0]!.ayme).toBe(ayme);
  });

  it("passes the connect link and port of the agentConnection option to the connection", async () => {
    started({ agentConnection: { port: 41234 } });
    started({ agentConnection: { link: "http://localhost:5173/#ayme=x" } });

    await loaded();

    expect(processConnections.map(({ options }) => options)).toEqual([
      { port: 41234 },
      { link: "http://localhost:5173/#ayme=x" },
    ]);
  });

  it("offers each Peek as peek.node.<name>, and nothing else", async () => {
    const ayme = started();
    let processed = 3;

    peek(ayme, () => ({ processed }), "jobs");
    processed = 4;

    expect(ayme.tools.list()).toEqual([
      expect.objectContaining({ name: "peek.node.jobs", group: "peek" }),
    ]);
    expect(await ayme.tools.run("peek.node.jobs", {})).toEqual({
      name: "jobs",
      instances: [{ values: { processed: 4 } }],
    });
  });

  it("tells its subscribers when a Peek Tool appears and goes", async () => {
    const ayme = started();
    const heard: string[][] = [];
    cleanups.push(
      ayme.tools.subscribe((tools) => heard.push(tools.map(({ name }) => name)))
    );

    const remove = ayme.peek(() => 1, "jobs");
    remove();
    await loaded();

    expect(heard).toEqual([["peek.node.jobs"], []]);
  });

  it("ends the connection and offers no tools once stopped", async () => {
    const ayme = createAyme({ agentConnection: true });
    const stop = ayme.start();
    peek(ayme, () => 1, "jobs");
    await loaded();

    stop();

    expect(processConnections[0]!.disposed).toBe(true);
    expect(ayme.tools.list()).toEqual([]);
    await expect(ayme.tools.run("peek.node.jobs", {})).rejects.toThrow(
      "not started"
    );
  });

  it("has no Peeks and no connection without the agentConnection option", async () => {
    const ayme = started({});

    peek(ayme, () => 1, "jobs");
    await loaded();

    expect(ayme.tools.list()).toEqual([]);
    expect(processConnections).toEqual([]);
  });
});
