import type { AgentConnection } from "../../connection";
import type { InspectorReply, WindowRequest } from "../domain/windowFrames";

/** An Inspector window as the relay sees it: where its replies go. */
export type InspectorWindow = { send(reply: InspectorReply): void };

const NO_PAGE = "No page is connected to this Ayme MCP server.";

/**
 * Relays the Inspector contract between external Inspector windows and the
 * page the server holds the Agent Connection with (ADR-0049). A window's
 * request goes to the paired page in the order it arrived, in plain data
 * the relay does not read but for a pick's id, and the page's answer goes
 * back to that window. A window that leaves has its picks still waiting
 * cancelled, so none blocks the page's clicks for a window that is gone.
 * The page pushes its events only while a window listens: the relay asks
 * it to start when the first window subscribes and to stop when the last
 * one leaves, and asks the new page again when the tab's page is replaced,
 * telling the windows so, since its revisions start again.
 */
export class InspectorRelay {
  readonly #connection: AgentConnection;
  readonly #windows = new Map<
    InspectorWindow,
    { listening: boolean; picks: Set<string> }
  >();
  #stopEvents: (() => void) | undefined;

  constructor(connection: AgentConnection) {
    this.#connection = connection;
    this.#followPage();
    connection.subscribe((event) => {
      if (event.type !== "paired") return;
      this.#followPage();
      for (const window of this.#windows.keys()) window.send({ reset: true });
      if (this.#listeners() > 0) this.#askPage("subscribe");
    });
  }

  /** A window connected: the relay answers its requests until it closes. */
  open(window: InspectorWindow): {
    receive(request: WindowRequest): void;
    close(): void;
  } {
    const state = { listening: false, picks: new Set<string>() };
    this.#windows.set(window, state);
    const setListening = (listening: boolean) => {
      if (state.listening === listening) return;
      const before = this.#listeners();
      state.listening = listening;
      const after = this.#listeners();
      if (before === 0 && after > 0) this.#askPage("subscribe");
      if (before > 0 && after === 0) this.#askPage("unsubscribe");
    };
    return {
      receive: ({ id, method, params }) => {
        if (method === "subscribe" || method === "unsubscribe") {
          setListening(method === "subscribe");
          window.send({ id, result: null });
          return;
        }
        // Made now, not later, so the page starts requests in arrival order.
        const link = this.#connection.inspectorLink;
        if (!link) return window.send({ id, error: NO_PAGE });
        const answered = link.request(method, params);
        const pick = method === "pick" ? pickId(params) : undefined;
        if (pick !== undefined) {
          state.picks.add(pick);
          answered.finally(() => state.picks.delete(pick)).catch(() => {});
        }
        answered.then(
          (result) => window.send({ id, result: result ?? null }),
          (error: unknown) =>
            window.send({
              id,
              error: error instanceof Error ? error.message : String(error),
            })
        );
      },
      close: () => {
        // Its picks wait for a click no window takes any more.
        for (const id of state.picks)
          this.#connection.inspectorLink
            ?.request("cancelPick", { id })
            .catch(() => {});
        state.picks.clear();
        setListening(false);
        this.#windows.delete(window);
      },
    };
  }

  /** Stops following the page's events. */
  dispose() {
    this.#stopEvents?.();
    this.#stopEvents = undefined;
  }

  #listeners() {
    return [...this.#windows.values()].filter(({ listening }) => listening)
      .length;
  }

  #askPage(method: "subscribe" | "unsubscribe") {
    // The page left: it has nothing to start or stop.
    this.#connection.inspectorLink?.request(method, undefined).catch(() => {});
  }

  /** Hears the events of the paired page, in place of the page before it. */
  #followPage() {
    this.#stopEvents?.();
    this.#stopEvents = this.#connection.inspectorLink?.onEvent((event) => {
      for (const [window, { listening }] of this.#windows)
        if (listening) window.send({ event });
    });
  }
}

/** The id a pick request names, which a later `cancelPick` names too. */
function pickId(params: unknown): string | undefined {
  const id = (params as { id?: unknown } | undefined)?.id;
  return typeof id === "string" ? id : undefined;
}
