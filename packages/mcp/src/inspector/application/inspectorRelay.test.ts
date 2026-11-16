import { describe, expect, it } from "vitest";

import { AgentConnection, type PageSession } from "../../connection";
import type { InspectorReply } from "../domain/windowFrames";
import { InspectorRelay } from "./inspectorRelay";

const hello = (tab: string) => ({ tab, url: "http://127.0.0.1:5173/" });

/**
 * A page that answers every request with `answer(method)` and records the
 * methods in the order it started them.
 */
function servePage(
  page: PageSession,
  answer: (method: string) => unknown = (method) => `answer to ${method}`
) {
  const started: string[] = [];
  void (async () => {
    for await (const { id, method } of page.inspector.requests(undefined)) {
      started.push(method);
      page.inspector.respond({ id, ok: true, result: answer(method) });
    }
  })();
  return started;
}

/** An Inspector window: the replies the server sent it. */
function openWindow(relay: InspectorRelay) {
  const replies: InspectorReply[] = [];
  const port = relay.open({ send: (reply) => replies.push(reply) });
  return { replies, ...port };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("InspectorRelay", () => {
  it("relays a window's requests to the page in order and returns the answers", async () => {
    const connection = new AgentConnection();
    const started = servePage(connection.attach(hello("a"), () => {})!);
    const window = openWindow(new InspectorRelay(connection));

    window.receive({ id: 1, method: "pick", params: { id: "p1" } });
    window.receive({ id: 2, method: "cancelPick", params: { id: "p1" } });
    await settle();

    expect(started).toEqual(["pick", "cancelPick"]);
    expect(window.replies).toEqual([
      { id: 1, result: "answer to pick" },
      { id: 2, result: "answer to cancelPick" },
    ]);
  });

  it("answers a request with an error while no page is paired", async () => {
    const window = openWindow(new InspectorRelay(new AgentConnection()));

    window.receive({ id: 1, method: "getState" });
    await settle();

    expect(window.replies).toEqual([
      { id: 1, error: expect.stringContaining("No page is connected") },
    ]);
  });

  it("answers with the page's error", async () => {
    const connection = new AgentConnection();
    const page = connection.attach(hello("a"), () => {})!;
    void (async () => {
      for await (const { id } of page.inspector.requests(undefined))
        page.inspector.respond({ id, ok: false, error: "no such command" });
    })();
    const window = openWindow(new InspectorRelay(connection));

    window.receive({ id: 1, method: "nope" });
    await settle();

    expect(window.replies).toEqual([{ id: 1, error: "no such command" }]);
  });

  it("asks the page for events once, however many windows listen, and gives each the events", async () => {
    const connection = new AgentConnection();
    const page = connection.attach(hello("a"), () => {})!;
    const started = servePage(page);
    const relay = new InspectorRelay(connection);
    const first = openWindow(relay);
    const second = openWindow(relay);

    first.receive({ id: 1, method: "subscribe" });
    second.receive({ id: 1, method: "subscribe" });
    await settle();
    page.inspector.emit({ type: "state", state: { revision: 2 } });

    expect(started).toEqual(["subscribe"]);
    for (const window of [first, second])
      expect(window.replies).toEqual([
        { id: 1, result: null },
        { event: { type: "state", state: { revision: 2 } } },
      ]);
  });

  it("tells the page to stop when the last listening window unsubscribes or closes", async () => {
    const connection = new AgentConnection();
    const started = servePage(connection.attach(hello("a"), () => {})!);
    const relay = new InspectorRelay(connection);
    const first = openWindow(relay);
    const second = openWindow(relay);
    first.receive({ id: 1, method: "subscribe" });
    second.receive({ id: 1, method: "subscribe" });

    first.receive({ id: 2, method: "unsubscribe" });
    await settle();
    expect(started).toEqual(["subscribe"]);
    second.close();
    await settle();

    expect(started).toEqual(["subscribe", "unsubscribe"]);
  });

  it("gives the page each window's pick as sent, cancels the one still waiting when its window closes, and unsubscribes once when both windows close", async () => {
    const connection = new AgentConnection();
    const page = connection.attach(hello("a"), () => {})!;
    const params: unknown[] = [];
    const started: string[] = [];
    void (async () => {
      for await (const { id, method, params: p } of page.inspector.requests(
        undefined
      )) {
        started.push(method);
        if (method === "pick") params.push(p);
        page.inspector.respond({ id, ok: true, result: null });
      }
    })();
    const relay = new InspectorRelay(connection);
    const first = openWindow(relay);
    const second = openWindow(relay);
    first.receive({ id: 1, method: "subscribe" });
    second.receive({ id: 1, method: "subscribe" });

    first.receive({ id: 2, method: "pick", params: { id: "pick-a-1" } });
    second.receive({ id: 2, method: "pick", params: { id: "pick-b-1" } });
    first.close();
    await settle();
    expect(started).toEqual(["subscribe", "pick", "pick", "cancelPick"]);
    second.close();
    await settle();

    expect(params).toEqual([{ id: "pick-a-1" }, { id: "pick-b-1" }]);
    expect(started).toEqual([
      "subscribe",
      "pick",
      "pick",
      "cancelPick",
      "unsubscribe",
    ]);
  });

  it("cancels the picks a window started when it leaves, while another window still listens", async () => {
    const connection = new AgentConnection();
    const page = connection.attach(hello("a"), () => {})!;
    const started: { method: string; params: unknown }[] = [];
    // A page whose picks wait for a click, and that answers anything else.
    void (async () => {
      for await (const { id, method, params } of page.inspector.requests(
        undefined
      )) {
        started.push({ method, params });
        if (method !== "pick")
          page.inspector.respond({ id, ok: true, result: null });
      }
    })();
    const relay = new InspectorRelay(connection);
    const first = openWindow(relay);
    const second = openWindow(relay);
    first.receive({ id: 1, method: "subscribe" });
    second.receive({ id: 1, method: "subscribe" });
    first.receive({ id: 2, method: "pick", params: { id: "pick-a-1" } });
    second.receive({ id: 2, method: "pick", params: { id: "pick-b-1" } });
    await settle();

    first.close();
    await settle();

    expect(started.slice(3)).toEqual([
      { method: "cancelPick", params: { id: "pick-a-1" } },
    ]);
  });

  it("resets the windows and subscribes the new page when the tab's page is replaced", async () => {
    const connection = new AgentConnection();
    const first = connection.attach(hello("a"), () => {})!;
    servePage(first);
    const relay = new InspectorRelay(connection);
    const window = openWindow(relay);
    window.receive({ id: 1, method: "subscribe" });
    await settle();

    connection.detach(first);
    const reloaded = connection.attach(hello("a"), () => {})!;
    const started = servePage(reloaded);
    await settle();
    reloaded.inspector.emit({ type: "state", state: { revision: 1 } });

    expect(started).toEqual(["subscribe"]);
    expect(window.replies).toEqual([
      { id: 1, result: null },
      { reset: true },
      { event: { type: "state", state: { revision: 1 } } },
    ]);
  });
});
