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
