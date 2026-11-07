import type { InspectorRequest, InspectorResponse } from "../../contract";

type Waiting = {
  resolve(result: unknown): void;
  reject(error: Error): void;
};

/**
 * What the server and one paired page say to each other for an external
 * Inspector (ADR-0049): the server's requests to the page's Inspector
 * contract, which wait for the page's answers, and the events the page
 * pushes. It relays plain data and knows no command. The requests leave in
 * the order they were made, one queue, so a `cancelPick` never overtakes
 * the `pick` it cancels.
 */
export class InspectorLink {
  readonly #outbox: InspectorRequest[] = [];
  #wake: (() => void) | undefined;
  readonly #waiting = new Map<string, Waiting>();
  readonly #listeners = new Set<(event: unknown) => void>();
  #nextId = 1;
  #closed = false;

  /** Asks the page, and resolves with its result or rejects with its error. */
  request(method: string, params: unknown): Promise<unknown> {
    if (this.#closed)
      return Promise.reject(new Error("The page left the Ayme MCP server."));
    const id = String(this.#nextId++);
    return new Promise((resolve, reject) => {
      this.#waiting.set(id, { resolve, reject });
      this.#outbox.push({ id, method, params });
      this.#rouse();
    });
  }

  /** The page answers a request; an answer to none waiting is ignored. */
  respond(response: InspectorResponse) {
    const waiting = this.#waiting.get(response.id);
    this.#waiting.delete(response.id);
    if (response.ok) waiting?.resolve(response.result);
    else waiting?.reject(new Error(response.error));
  }

  /** The requests for the page, in order, until `signal` aborts. */
  async *requests(
    signal: AbortSignal | undefined
  ): AsyncGenerator<InspectorRequest> {
    signal?.addEventListener("abort", this.#rouse, { once: true });
    try {
      while (!signal?.aborted) {
        const next = this.#outbox.shift();
        if (next) yield next;
        else await new Promise<void>((resolve) => (this.#wake = resolve));
      }
    } finally {
      signal?.removeEventListener("abort", this.#rouse);
    }
  }

  /** The page pushes an event. */
  emit(event: unknown) {
    for (const listener of [...this.#listeners]) listener(event);
  }

  /** Calls `listener` with each event the page pushes; returns what stops it. */
  onEvent(listener: (event: unknown) => void): () => void {
    this.#listeners.add(listener);
    return () => void this.#listeners.delete(listener);
  }

  /** The page is gone: every request still waiting fails, and later ones too. */
  close() {
    this.#closed = true;
    this.#outbox.length = 0;
    const error = new Error("The page left the Ayme MCP server.");
    for (const waiting of this.#waiting.values()) waiting.reject(error);
    this.#waiting.clear();
    this.#rouse();
  }

  readonly #rouse = () => {
    const resolve = this.#wake;
    this.#wake = undefined;
    resolve?.();
  };
}
