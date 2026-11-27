import type {
  InspectorCommandResult,
  InspectorContract,
  InspectorEvent,
  InspectorObserver,
  InspectorState,
} from "@ayme-dev/ayme/inspector";

// The channel transport of the Inspector contract (ADR-0049): the same
// contract the inline transport calls directly, over a WebSocket to the
// process that serves this window: `ayme mcp`, which relays it to the page,
// or a Session's, which serves it from the Tab it works on. `{ reset: true }`
// and a Session's `{ tab }` both say the window shows a new document, whose
// revisions start again; a Session's requests name the Tab it told last. A
// Session tells a window a one-use code admitted its `{ token }`, to connect
// again with.

type Reply =
  | { id: number; result: unknown }
  | { id: number; error: string }
  | { event: InspectorEvent }
  | { reset: true }
  | { tab: number }
  | { token: string }
  | { ended: string };

type Waiting = {
  resolve(result: unknown): void;
  reject(error: Error): void;
  /** The Tab its request named. */
  tab?: number;
};

type Request = { id: number; method: string; params?: unknown };

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
  /**
   * How many times in a row to connect again before giving the server up
   * for lost. Without it, the transport connects again for ever.
   */
  retries?: number;
  /** Called once, when the server is given up for lost. */
  onLost?: () => void;
  /** Called with the token a Session tells a window a one-use code
   * admitted, which the window connects again with. */
  onToken?: (token: string) => void;
  /** Called once, with what to say, when the server says the Session it
   * serves ended: the transport connects no more, since no Session comes
   * back at that address. */
  onEnded?: (notice: string) => void;
  /**
   * Whether the server tells the Tab the window shows, as a Session's
   * does: each request waits until it did, and names that Tab, so the
   * Session refuses one made for a Tab it no longer shows; an answer to a
   * request made on the Tab before is dropped. A new Tab is a new page.
   */
  followsTabs?: boolean;
};

/**
 * The Inspector contract over the channel at `url`, read again for each
 * connection when it is a function. Requests leave in the
 * order they are made, those made before the socket opens too, so a
 * `cancelPick` never overtakes its `pick`. When the page behind the server
 * changes, its revisions start again; the transport raises them past the
 * newest it gave, so the client, which never lets a lower revision replace a
 * newer state, shows the new page. When the connection closes, the requests
 * waiting fail and the transport connects again, as for a new page. After
 * `retries` connections in a row that did not open, it stops: every request
 * fails from then on.
 */
export function webSocketInspectorContract(
  url: string | (() => string),
  {
    WebSocket: WebSocketClass = WebSocket,
    reconnectMs = 1000,
    onNewPage,
    retries,
    onLost,
    onToken,
    onEnded,
    followsTabs = false,
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
  // The connections in a row that did not open, and whether it gave up.
  let failed = 0;
  let lost = false;
  // The Tab the window shows, as this connection's server told it.
  let shownTab: number | undefined;
  const closed = () => new Error("The connection to ayme's process closed.");
  const anotherTab = () => new Error("The Inspector shows another Tab now.");

  const raise = <T extends { revision: number }>(value: T): T => {
    const revision = value.revision + base;
    newest = Math.max(newest, revision);
    return { ...value, revision };
  };
  const raiseEvent = (event: InspectorEvent): InspectorEvent => ({
    type: "state",
    state: raise(event.state),
  });
  const raiseResult = (result: InspectorCommandResult) => ({
    ...result,
    state: raise(result.state),
  });

  const emit = (event: InspectorEvent) => {
    for (const observer of [...observers]) observer.onEvent(event);
  };

  const send = (method: string, params?: unknown) =>
    new Promise<unknown>((resolve, reject) => {
      if (lost) return reject(closed());
      const id = nextId++;
      waiting.set(id, { resolve, reject });
      outbox.push({ id, method, params });
      flush();
    });
  // Requests wait here, in order, until the socket is open and, on a
  // Session, until it told the Tab they name.
  const outbox: Request[] = [];
  const flush = () => {
    if (socket.readyState !== WebSocketClass.OPEN) return;
    if (followsTabs && shownTab === undefined) return;
    for (const request of outbox.splice(0)) {
      const pending = waiting.get(request.id);
      if (pending && followsTabs) pending.tab = shownTab;
      socket.send(
        JSON.stringify(followsTabs ? { ...request, tab: shownTab } : request)
      );
    }
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
    socket = new WebSocketClass(typeof url === "string" ? url : url());
    socket.onopen = () => {
      failed = 0;
      flush();
      if (!reconnected) return;
      // The server knows nothing of this connection's subscription.
      if (observers.size > 0) void send("subscribe");
      reset();
    };
    socket.onmessage = ({ data }) => {
      const reply = JSON.parse(String(data)) as Reply;
      if ("reset" in reply) return reset();
      if ("tab" in reply) {
        const before = shownTab;
        shownTab = reply.tab;
        if (before !== undefined && before !== reply.tab) reset();
        return flush();
      }
      if ("token" in reply) return onToken?.(reply.token);
      if ("ended" in reply) {
        lost = true;
        return onEnded?.(reply.ended);
      }
      if ("event" in reply) return emit(raiseEvent(reply.event));
      const pending = waiting.get(reply.id);
      waiting.delete(reply.id);
      if (followsTabs && pending && pending.tab !== shownTab)
        pending.reject(anotherTab());
      else if ("error" in reply) pending?.reject(new Error(reply.error));
      else pending?.resolve(reply.result);
    };
    socket.onclose = () => {
      const error = closed();
      for (const pending of waiting.values()) pending.reject(error);
      waiting.clear();
      // What was not sent is not sent to the next connection either.
      outbox.length = 0;
      shownTab = undefined;
      if (lost) return;
      if (retries !== undefined && failed >= retries) {
        lost = true;
        return onLost?.();
      }
      failed++;
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
