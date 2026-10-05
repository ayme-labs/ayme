import type {
  PageHello,
  PageLeaving,
  PageTool,
  ToolCall,
  ToolCallOutcome,
} from "../../contract";
import { unansweredCallText, type PageExit } from "../domain/unansweredCall";

/**
 * How long the server waits for a tab that went away with calls in flight to
 * reconnect, so it can answer them with the new page's tools.
 */
export const RECONNECT_WAIT_MS = 3_000;

/** What happened on the Agent Connection. */
export type ConnectionEvent =
  | { type: "paired" }
  | { type: "unpaired" }
  | { type: "toolsChanged"; tools: readonly PageTool[] };

type Answer = (outcome: ToolCallOutcome) => void;

/** Answers every call in `calls` for a page that left as `exit` says. */
function answerUnanswered(calls: Map<string, Answer>, exit: PageExit) {
  const error = unansweredCallText(exit);
  for (const [callId, answer] of calls) answer({ callId, ok: false, error });
}

/**
 * One page connected to the server through the channel: which tab it is,
 * the tools it last reported, and the calls the server sent it that wait
 * for an answer.
 */
export class PageSession {
  /** The id the tab keeps for its pairing across reloads and navigation. */
  readonly tab: string;
  /** The document's URL when it connected. */
  readonly url: string;
  /** Ends the page's channel and tells it another tab paired in its place. */
  readonly disconnect: () => void;
  /** The new document the page said it started loading, if any. */
  leaving: PageLeaving | undefined;
  #tools: readonly PageTool[] = [];
  readonly #outbox: ToolCall[] = [];
  #wake: (() => void) | undefined;
  #pending = new Map<string, Answer>();
  readonly #onToolsChanged: (tools: readonly PageTool[]) => void;

  constructor(
    hello: PageHello,
    disconnect: () => void,
    onToolsChanged: (tools: readonly PageTool[]) => void
  ) {
    this.tab = hello.tab;
    this.url = hello.url;
    this.disconnect = disconnect;
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

  /**
   * Takes the calls the page has not answered, for the server to answer;
   * the page's later answers to them are ignored.
   */
  takeUnanswered(): Map<string, Answer> {
    const pending = this.#pending;
    this.#pending = new Map();
    this.#outbox.length = 0;
    return pending;
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

/** Calls whose page went away, waiting for its tab to reconnect. */
type Away = {
  tab: string;
  url: string;
  leaving: PageLeaving | undefined;
  calls: Map<string, Answer>;
  timer: ReturnType<typeof setTimeout>;
};

/**
 * The server side of the Agent Connection: the one page paired with this
 * server, if any, its tools, and calls to them.
 *
 * A page belongs to a tab, which keeps its id across reloads and
 * navigation. The newest tab wins: when another tab connects, the paired
 * tab's calls are answered, it is disconnected, and it may not connect
 * again. Every call gets one answer: the page's, or the server's when the
 * page left first (see `unansweredCallText`).
 */
export class AgentConnection {
  #page: PageSession | undefined;
  #away: Away | undefined;
  readonly #replacedTabs = new Set<string>();
  #nextCallId = 1;
  readonly #listeners = new Set<(event: ConnectionEvent) => void>();

  /** The paired page's tools; empty while no page is paired. */
  get tools(): readonly PageTool[] {
    return this.#page?.tools ?? [];
  }

  get paired(): boolean {
    return this.#page !== undefined;
  }

  /**
   * The id of the tab the server works with: the paired page's, or, while
   * no page is paired, the away tab's it waits for to reconnect.
   */
  get busyWith(): string | undefined {
    return this.#page?.tab ?? this.#away?.tab;
  }

  /**
   * A page introduced itself on a channel the server accepted. It becomes
   * the paired page, unless a newer tab replaced its tab: then it is
   * disconnected and `undefined` returned.
   */
  attach(hello: PageHello, disconnect: () => void): PageSession | undefined {
    if (this.#replacedTabs.has(hello.tab)) {
      disconnect();
      return undefined;
    }
    const previous = this.#page;
    // The same tab's earlier document is gone, whether or not its channel
    // has closed yet.
    if (previous?.tab === hello.tab) this.detach(previous);
    else if (previous) this.#replace(previous);
    if (this.#away && this.#away.tab !== hello.tab) {
      this.#replacedTabs.add(this.#away.tab);
      this.#answerAway({ type: "replaced" });
    }

    const page = new PageSession(hello, disconnect, (tools) => {
      if (this.#page !== page) return;
      const away = this.#away;
      if (away?.tab === page.tab) {
        const reload = away.leaving?.reload ?? page.url === away.url;
        this.#answerAway({
          type: reload ? "reloaded" : "navigated",
          url: page.url,
          tools: tools.map((tool) => tool.name),
        });
      }
      this.#emit({ type: "toolsChanged", tools });
    });
    this.#page = page;
    this.#emit({ type: "paired" });
    return page;
  }

  /**
   * A page's channel closed. The server waits up to `RECONNECT_WAIT_MS` for
   * its tab to reconnect, calls in flight or not, and stays busy with that
   * tab meanwhile; the calls are answered when it reconnects or the wait
   * ends.
   */
  detach(page: PageSession) {
    if (this.#page !== page) return;
    this.#page = undefined;
    this.#emit({ type: "unpaired" });
    const calls = page.takeUnanswered();
    const away = this.#away;
    if (away?.tab === page.tab) {
      for (const [callId, answer] of calls) away.calls.set(callId, answer);
      away.leaving = page.leaving ?? away.leaving;
      return;
    }
    const { tab, url, leaving } = page;
    const timer = setTimeout(() => {
      const left = this.#away?.leaving;
      this.#answerAway(
        left
          ? { type: left.reload ? "reloaded" : "navigated", url: left.url }
          : { type: "closed" }
      );
    }, RECONNECT_WAIT_MS);
    // In Node, the wait never keeps a stopping server running.
    (timer as { unref?: () => void }).unref?.();
    this.#away = { tab, url, leaving, calls, timer };
  }

  /** Runs the paired page's tool `name`. Throws while no page is paired. */
  call(name: string, input: unknown): Promise<ToolCallOutcome> {
    if (!this.#page) throw new Error("No page is connected.");
    const callId = String(this.#nextCallId++);
    return this.#page.call({ callId, name, input });
  }

  /**
   * The server stops: every call still waiting is answered, and no page is
   * paired any more.
   */
  close() {
    const page = this.#page;
    if (page) {
      this.#page = undefined;
      answerUnanswered(page.takeUnanswered(), { type: "stopped" });
      this.#emit({ type: "unpaired" });
    }
    this.#answerAway({ type: "stopped" });
  }

  /** Calls `listener` with every event; returns what unsubscribes it. */
  subscribe(listener: (event: ConnectionEvent) => void): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  /** Another tab connected: answers `page`'s calls and disconnects it. */
  #replace(page: PageSession) {
    this.#replacedTabs.add(page.tab);
    this.#page = undefined;
    answerUnanswered(page.takeUnanswered(), { type: "replaced" });
    this.#emit({ type: "unpaired" });
    page.disconnect();
  }

  #answerAway(exit: PageExit) {
    const away = this.#away;
    if (!away) return;
    this.#away = undefined;
    clearTimeout(away.timer);
    answerUnanswered(away.calls, exit);
  }

  #emit(event: ConnectionEvent) {
    for (const listener of this.#listeners) listener(event);
  }
}
