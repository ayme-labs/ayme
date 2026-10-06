import { afterEach, describe, expect, it, vi } from "vitest";

import { AgentConnection, RECONNECT_WAIT_MS } from "./agentConnection";

const hello = (tab: string, url = "http://127.0.0.1:5173/") => ({ tab, url });
const errorOf = async (outcome: Promise<unknown>) =>
  JSON.parse(((await outcome) as { error: string }).error) as {
    error: string;
  };

describe("AgentConnection", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("answers every call still waiting when the server stops, and unpairs", async () => {
    const connection = new AgentConnection();
    connection.attach(hello("a"), () => {});
    const call = connection.call("hold", {});

    connection.close();

    expect(await errorOf(call)).toMatchObject({
      error: expect.stringMatching(/^The Ayme MCP server stopped/),
    });
    expect(connection.paired).toBe(false);
  });

  it("answers the calls of a page that went away when the server stops during the wait", async () => {
    const connection = new AgentConnection();
    const page = connection.attach(hello("a"), () => {})!;
    const call = connection.call("hold", {});
    connection.detach(page);

    connection.close();

    expect(await errorOf(call)).toMatchObject({
      error: expect.stringMatching(/^The Ayme MCP server stopped/),
    });
  });

  it("answers the calls of a page that went away once the wait ends", async () => {
    vi.useFakeTimers();
    const connection = new AgentConnection();
    const page = connection.attach(hello("a"), () => {})!;
    const call = connection.call("hold", {});
    connection.detach(page);

    vi.advanceTimersByTime(RECONNECT_WAIT_MS);

    expect(await errorOf(call)).toMatchObject({
      error: expect.stringMatching(/^The tab closed/),
    });
  });

  it("stays busy with a tab that went away, calls or not, until the wait ends", () => {
    vi.useFakeTimers();
    const connection = new AgentConnection();
    const page = connection.attach(hello("a"), () => {})!;
    connection.detach(page);

    expect(connection.busyWith).toBe("a");
    vi.advanceTimersByTime(RECONNECT_WAIT_MS);
    expect(connection.busyWith).toBeUndefined();
  });

  it("ignores the page's answer to a call the server already answered", async () => {
    const connection = new AgentConnection();
    const page = connection.attach(hello("a"), () => {})!;
    const call = connection.call("hold", {});
    connection.attach(hello("b"), () => {});

    page.answer({ callId: "1", ok: true, result: "late" });

    expect(await errorOf(call)).toMatchObject({
      error: expect.stringMatching(/^Another tab connected/),
    });
  });
});

const tool = (name: string) => ({ name, description: "", inputSchema: {} });

describe("AgentConnection with App Processes", () => {
  it("lists the page's tools and every App Process's, and sends each call to the connection that offers the tool", async () => {
    const connection = new AgentConnection();
    const page = connection.attach(hello("a"), () => {})!;
    page.publishTools([tool("snapshot")]);
    const server = connection.attachProcess({ process: "server" });
    server.publishTools([tool("peek.node.session")]);
    const worker = connection.attachProcess({ process: "worker" });
    worker.publishTools([tool("peek.node.jobs")]);

    void connection.call("peek.node.jobs", {});
    void connection.call("snapshot", {});

    expect(connection.tools.map(({ name }) => name)).toEqual([
      "snapshot",
      "peek.node.session",
      "peek.node.jobs",
    ]);
    expect(await sentCalls(worker)).toEqual(["peek.node.jobs"]);
    expect(await sentCalls(page)).toEqual(["snapshot"]);
    expect(await sentCalls(server)).toEqual([]);
  });

  it("pairs an App Process beside the tab without replacing it or another App Process", () => {
    const connection = new AgentConnection();
    const disconnectPage = vi.fn();
    connection.attach(hello("a"), disconnectPage);
    connection.attachProcess({ process: "server" }).publishTools([tool("x")]);

    connection.attachProcess({ process: "worker" }).publishTools([tool("y")]);

    expect(disconnectPage).not.toHaveBeenCalled();
    expect(connection.busyWith).toBe("a");
    expect(connection.tools.map(({ name }) => name)).toEqual(["x", "y"]);
  });

  it("keeps its App Processes when another tab replaces the page", () => {
    const connection = new AgentConnection();
    connection.attach(hello("a"), () => {});
    connection.attachProcess({ process: "server" }).publishTools([tool("x")]);

    connection.attach(hello("b"), () => {})!.publishTools([tool("snapshot")]);

    expect(connection.tools.map(({ name }) => name)).toEqual(["snapshot", "x"]);
  });

  it("is connected with only an App Process, and busy with no tab", () => {
    const connection = new AgentConnection();

    connection.attachProcess({ process: "server" });

    expect(connection.connected).toBe(true);
    expect(connection.paired).toBe(false);
    expect(connection.busyWith).toBeUndefined();
  });

  it("drops an App Process's tools when it leaves, and answers its calls at once", async () => {
    const connection = new AgentConnection();
    const server = connection.attachProcess({ process: "server" });
    server.publishTools([tool("peek.node.session")]);
    const call = connection.call("peek.node.session", {});

    connection.detach(server);

    expect(await errorOf(call)).toMatchObject({
      error: expect.stringMatching(/^The App Process exited/),
    });
    expect(connection.tools).toEqual([]);
    expect(connection.connected).toBe(false);
  });

  it("replaces an App Process's earlier session when it connects again", () => {
    const connection = new AgentConnection();
    connection.attachProcess({ process: "server" }).publishTools([tool("x")]);

    connection.attachProcess({ process: "server" }).publishTools([tool("y")]);

    expect(connection.tools.map(({ name }) => name)).toEqual(["y"]);
  });

  it("keeps the first App Process's tool of a name, and hides the second's", async () => {
    const connection = new AgentConnection();
    const first = connection.attachProcess({ process: "server" });
    first.publishTools([tool("peek.node.jobs")]);
    const second = connection.attachProcess({ process: "worker" });

    second.publishTools([tool("peek.node.jobs"), tool("z")]);
    void connection.call("peek.node.jobs", {});

    expect(connection.hidden).toEqual([
      { name: "peek.node.jobs", offeredBy: "process" },
    ]);
    expect(connection.tools.map(({ name }) => name)).toEqual([
      "peek.node.jobs",
      "z",
    ]);
    expect(await sentCalls(first)).toEqual(["peek.node.jobs"]);
    expect(await sentCalls(second)).toEqual([]);
  });

  it("shows the second App Process's tool once the first one leaves", async () => {
    const connection = new AgentConnection();
    const first = connection.attachProcess({ process: "server" });
    first.publishTools([tool("peek.node.jobs")]);
    const second = connection.attachProcess({ process: "worker" });
    second.publishTools([tool("peek.node.jobs")]);

    connection.detach(first);
    void connection.call("peek.node.jobs", {});

    expect(connection.hidden).toEqual([]);
    expect(await sentCalls(second)).toEqual(["peek.node.jobs"]);
  });

  it("tells an App Process each time its hidden tools change, as when the earlier one reports the same name later", async () => {
    const connection = new AgentConnection();
    const first = connection.attachProcess({ process: "server" });
    const second = connection.attachProcess({ process: "worker" });
    second.publishTools([tool("peek.node.jobs")]);
    const stop = new AbortController();
    const lists: string[][] = [];
    const following = (async () => {
      for await (const hidden of connection.hiddenToolLists(
        second,
        stop.signal
      ))
        lists.push(hidden.map(({ name }) => name));
    })();

    await tick();
    first.publishTools([tool("peek.node.jobs")]);
    await tick();
    first.publishTools([]);
    await tick();
    stop.abort();
    await following;

    expect(lists).toEqual([[], ["peek.node.jobs"], []]);
  });

  it("keeps the page's tool of a name an App Process offers too", () => {
    const connection = new AgentConnection();
    connection.attach(hello("a"), () => {})!.publishTools([tool("snapshot")]);

    connection
      .attachProcess({ process: "server" })
      .publishTools([tool("snapshot")]);

    expect(connection.hidden).toEqual([
      { name: "snapshot", offeredBy: "page" },
    ]);
  });

  it("tells its listeners when an App Process pairs, reports tools and leaves", () => {
    const connection = new AgentConnection();
    const events: string[] = [];
    connection.subscribe((event) => events.push(event.type));

    const server = connection.attachProcess({ process: "server" });
    server.publishTools([tool("x")]);
    connection.detach(server);

    expect(events).toEqual([
      "processPaired",
      "toolsChanged",
      "processUnpaired",
    ]);
  });

  it("answers an App Process's calls when the server stops", async () => {
    const connection = new AgentConnection();
    connection.attachProcess({ process: "server" }).publishTools([tool("x")]);
    const call = connection.call("x", {});

    connection.close();

    expect(await errorOf(call)).toMatchObject({
      error: expect.stringMatching(/^The Ayme MCP server stopped/),
    });
    expect(connection.connected).toBe(false);
  });
});

/** Lets every pending callback and microtask run. */
const tick = () => new Promise((resolve) => setTimeout(resolve));

/** The names of the calls the server has sent `session` so far. */
async function sentCalls(session: {
  calls(signal: AbortSignal): AsyncGenerator<{ name: string }>;
}) {
  const names: string[] = [];
  const stop = new AbortController();
  setTimeout(() => stop.abort());
  for await (const call of session.calls(stop.signal)) names.push(call.name);
  return names;
}

describe("AgentConnection's App Process tools, as the page reads and runs them", () => {
  it("lists the App Processes' tools the agent sees, without the page's", () => {
    const connection = new AgentConnection();
    connection.attach(hello("a"), () => {})!.publishTools([tool("snapshot")]);
    connection
      .attachProcess({ process: "server" })
      .publishTools([tool("peek.node.session"), tool("snapshot")]);
    connection
      .attachProcess({ process: "worker" })
      .publishTools([tool("peek.node.session"), tool("peek.node.jobs")]);

    expect(connection.processTools.map(({ name }) => name)).toEqual([
      "peek.node.session",
      "peek.node.jobs",
    ]);
  });

  it("gives the App Processes' tools at once and after each change to them, until stopped", async () => {
    const connection = new AgentConnection();
    const server = connection.attachProcess({ process: "server" });
    server.publishTools([tool("peek.node.session")]);
    const stop = new AbortController();
    const lists: string[][] = [];
    const following = (async () => {
      for await (const tools of connection.processToolLists(stop.signal))
        lists.push(tools.map(({ name }) => name));
    })();

    await tick();
    connection.attach(hello("a"), () => {})!.publishTools([tool("snapshot")]);
    const worker = connection.attachProcess({ process: "worker" });
    worker.publishTools([tool("peek.node.jobs")]);
    await tick();
    connection.detach(server);
    await tick();
    stop.abort();
    await following;

    expect(lists).toEqual([
      ["peek.node.session"],
      ["peek.node.session", "peek.node.jobs"],
      ["peek.node.jobs"],
    ]);
  });

  it("sends a page's call to the App Process that offers the tool", async () => {
    const connection = new AgentConnection();
    const page = connection.attach(hello("a"), () => {})!;
    const server = connection.attachProcess({ process: "server" });
    server.publishTools([tool("peek.node.jobs")]);

    void connection.callProcess("peek.node.jobs", {});

    expect(await sentCalls(server)).toEqual(["peek.node.jobs"]);
    expect(await sentCalls(page)).toEqual([]);
  });

  it("never sends a page's call to the page, even for a tool the page offers", async () => {
    const connection = new AgentConnection();
    const page = connection.attach(hello("a"), () => {})!;
    page.publishTools([tool("snapshot")]);

    const outcome = await connection.callProcess("snapshot", {});

    expect(outcome).toMatchObject({
      ok: false,
      error: 'No App Process offers the tool "snapshot".',
    });
    expect(await sentCalls(page)).toEqual([]);
  });
});
