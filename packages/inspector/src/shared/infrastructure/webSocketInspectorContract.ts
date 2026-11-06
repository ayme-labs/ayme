import type {
  InspectorCommandResult,
  InspectorContract,
  InspectorEvent,
  InspectorObserver,
  InspectorState,
} from "@ayme-dev/ayme/inspector";

// The channel transport of the Inspector contract (ADR-0049): the same
// contract the inline transport calls directly, over a WebSocket to the
// `ayme mcp` server that serves this window, which relays it to the page.
// The frames are `@ayme-dev/mcp`'s (its `inspector` slice): requests
// `{ id, method, params }`, where `method` is a contract method, or
// `subscribe` / `unsubscribe` for events; replies `{ id, result }` or
// `{ id, error }`; the pushes `{ event }`; and `{ reset: true }`, which says
// the page is a new document, whose revisions start again.

type Reply =
  | { id: number; result: unknown }
  | { id: number; error: string }
  | { event: InspectorEvent }
  | { reset: true };

type Waiting = { resolve(result: unknown): void; reject(error: Error): void };

export type WebSocketInspectorOptions = {
  /** The WebSocket class to connect with; the global one unless given. */
  WebSocket?: typeof WebSocket;
  /** How long to wait before connecting again after the connection closed. */
  reconnectMs?: number;
  /**
   * Called when the page the server relays is a new document (it reloaded
   * or was replaced) or the server connected again, before the new state is
   * read: what the Inspector kept of the old page is the Inspector's to carry
   * over, as it does across a reload.
   */
  onNewPage?: () => void;
};

/**
 * The Inspector contract over the channel at `url`. Requests leave in the
 * order they are made, those made before the socket opens too, so a
 * `cancelPick` never overtakes its `pick`. When the page behind the server
 * changes, its revisions start again; the transport raises them past the
 * newest it gave, so the client, which never lets a lower revision replace a
 * newer state, shows the new page. When the connection closes, the requests
 * waiting fail and the transport connects again, as for a new page.
 */
export function webSocketInspectorContract(
  url: string,
  {
    WebSocket: WebSocketClass = WebSocket,
    reconnectMs = 1000,
    onNewPage,
  }: WebSocketInspectorOptions = {}
): InspectorContract {
  const observers = new Set<InspectorObserver>();
  const waiting = new Map<number, Waiting>();
  let socket: WebSocket;
  let nextId = 1;
  // What the raw revisions of the current page are raised by, and the newest
  // revision given so far.
  let base = 0;
  let newest = 0;

  const raise = <T extends { revision: number }>(value: T): T => {
    const revision = value.revision + base;
    newest = Math.max(newest, revision);
    return { ...value, revision };
  };
  const raiseEvent = (event: InspectorEvent): InspectorEvent =>
    event.type === "state"
      ? { type: "state", state: raise(event.state) }
      : { ...event, revision: raise(event).revision };
  const raiseResult = (result: InspectorCommandResult) => ({
    ...result,
    state: raise(result.state),
  });

  const emit = (event: InspectorEvent) => {
    for (const observer of [...observers]) observer.onEvent(event);
  };

  const send = (method: string, params?: unknown) =>
    new Promise<unknown>((resolve, reject) => {
      const id = nextId++;
      waiting.set(id, { resolve, reject });
      transmit(JSON.stringify({ id, method, params }));
    });
  // Frames wait here until the socket is open, in order.
  const outbox: string[] = [];
  const transmit = (frame: string) => {
    if (socket.readyState === WebSocketClass.OPEN && outbox.length === 0)
      socket.send(frame);
    else outbox.push(frame);
  };

  /** The page is new: its state is read and given as an event. */
  const reset = () => {
    base = newest;
    onNewPage?.();
    void send("getState").then(
      (state) =>
        emit({
          type: "state",
          state: raise(state as InspectorState),
        }),
      (error: unknown) => fail(error)
    );
  };
  const fail = (error: unknown) => {
    const failure = error instanceof Error ? error : new Error(String(error));
    for (const observer of [...observers]) observer.onError(failure);
  };

  const connect = (reconnected: boolean) => {
    socket = new WebSocketClass(url);
    socket.onopen = () => {
      for (const frame of outbox.splice(0)) socket.send(frame);
      if (!reconnected) return;
      // The server knows nothing of this connection's subscription.
      if (observers.size > 0) void send("subscribe");
      reset();
    };
    socket.onmessage = ({ data }) => {
      const reply = JSON.parse(String(data)) as Reply;
      if ("reset" in reply) return reset();
      if ("event" in reply) return emit(raiseEvent(reply.event));
      const pending = waiting.get(reply.id);
      waiting.delete(reply.id);
      if ("error" in reply) pending?.reject(new Error(reply.error));
      else pending?.resolve(reply.result);
    };
    socket.onclose = () => {
      const error = new Error("The connection to the Ayme MCP server closed.");
      for (const pending of waiting.values()) pending.reject(error);
      waiting.clear();
      // What was not sent is not sent to the next connection either.
      outbox.length = 0;
      setTimeout(() => connect(true), reconnectMs);
    };
    socket.onerror = () => {};
  };
  connect(false);

  const command = async (method: string, params: unknown) =>
    raiseResult((await send(method, params)) as InspectorCommandResult);

  return {
    async getState() {
      return raise((await send("getState")) as InspectorState);
    },
    subscribe(observer) {
      observers.add(observer);
      if (observers.size === 1) void send("subscribe").catch(fail);
      return () => {
        if (!observers.delete(observer) || observers.size > 0) return;
        void send("unsubscribe").catch(() => {});
      };
    },
    runTool: (request) => command("runTool", request),
    highlight: (request) => command("highlight", request),
    pick: (request) => command("pick", request),
    cancelPick: (request) => command("cancelPick", request),
    demo: (request) => command("demo", request),
    look: async () => (await send("look")) as never,
    recordedPageState: async () =>
      ((await send("recordedPageState")) ?? undefined) as never,
    pomDefinitionText: async (request) =>
      (await send("pomDefinitionText", request)) as string,
  };
}
