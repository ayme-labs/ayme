import type { PageTool, ToolCall, ToolCallOutcome } from "../../contract";

/** What happened on the Agent Connection. */
export type ConnectionEvent =
  | { type: "paired" }
  | { type: "unpaired" }
  | { type: "toolsChanged"; tools: readonly PageTool[] };

/**
 * One page connected to the server through the channel: the tools it last
 * reported, and the calls the server sent it that wait for an answer.
 */
export class PageSession {
  #tools: readonly PageTool[] = [];
  readonly #outbox: ToolCall[] = [];
  #wake: (() => void) | undefined;
  readonly #pending = new Map<string, (outcome: ToolCallOutcome) => void>();
  readonly #onToolsChanged: (tools: readonly PageTool[]) => void;

  constructor(onToolsChanged: (tools: readonly PageTool[]) => void) {
    this.#onToolsChanged = onToolsChanged;
  }

  get tools(): readonly PageTool[] {
    return this.#tools;
  }

  /** The page reports its tools. */
  publishTools(tools: readonly PageTool[]) {
    this.#tools = tools;
    this.#onToolsChanged(tools);
  }

  /** Sends `call` to the page and resolves with the page's answer. */
  call(call: ToolCall): Promise<ToolCallOutcome> {
    return new Promise((resolve) => {
      this.#pending.set(call.callId, resolve);
      this.#outbox.push(call);
      const resolveWait = this.#wake;
      this.#wake = undefined;
      resolveWait?.();
    });
  }

  /** The page answers a call; an answer to no pending call is ignored. */
  answer(outcome: ToolCallOutcome) {
    const resolve = this.#pending.get(outcome.callId);
    this.#pending.delete(outcome.callId);
    resolve?.(outcome);
  }

  /** The calls for the page, in order, until `signal` aborts. */
  async *calls(signal: AbortSignal | undefined): AsyncGenerator<ToolCall> {
    const wake = () => {
      const resolve = this.#wake;
      this.#wake = undefined;
      resolve?.();
    };
    signal?.addEventListener("abort", wake, { once: true });
    try {
      while (!signal?.aborted) {
        const next = this.#outbox.shift();
        if (next) yield next;
        else await new Promise<void>((resolve) => (this.#wake = resolve));
      }
    } finally {
      signal?.removeEventListener("abort", wake);
    }
  }
}

/**
 * The server side of the Agent Connection: the one page paired with this
 * server, if any, its tools, and calls to them. The page that connected
 * last is the paired one.
 */
export class AgentConnection {
  #page: PageSession | undefined;
  #nextCallId = 1;
  readonly #listeners = new Set<(event: ConnectionEvent) => void>();

  /** The paired page's tools; empty while no page is paired. */
  get tools(): readonly PageTool[] {
    return this.#page?.tools ?? [];
  }

  get paired(): boolean {
    return this.#page !== undefined;
  }

  /** A page connected with the server's token; it becomes the paired page. */
  attach(): PageSession {
    const page = new PageSession((tools) => {
      if (this.#page === page) this.#emit({ type: "toolsChanged", tools });
    });
    this.#page = page;
    this.#emit({ type: "paired" });
    return page;
  }

  /** A page's channel closed. */
  detach(page: PageSession) {
    if (this.#page !== page) return;
    this.#page = undefined;
    this.#emit({ type: "unpaired" });
  }

  /** Runs the paired page's tool `name`. Throws while no page is paired. */
  call(name: string, input: unknown): Promise<ToolCallOutcome> {
    if (!this.#page) throw new Error("No page is connected.");
    const callId = String(this.#nextCallId++);
    return this.#page.call({ callId, name, input });
  }

  /** Calls `listener` with every event; returns what unsubscribes it. */
  subscribe(listener: (event: ConnectionEvent) => void): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  #emit(event: ConnectionEvent) {
    for (const listener of this.#listeners) listener(event);
  }
}
