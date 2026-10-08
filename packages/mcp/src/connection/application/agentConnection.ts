import type {
  PageHello,
  PageLeaving,
  PageTool,
  ProcessHello,
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
  | { type: "processPaired" }
  | { type: "processUnpaired" }
  | { type: "toolsChanged"; tools: readonly PageTool[] };

type Answer = (outcome: ToolCallOutcome) => void;

/** Answers every call in `calls` for a page that left as `exit` says. */
function answerUnanswered(calls: Map<string, Answer>, exit: PageExit) {
  const error = unansweredCallText(exit);
  for (const [callId, answer] of calls) answer({ callId, ok: false, error });
}

/**
 * One page or App Process connected to the server through the channel: the
 * tools it last reported, and the calls the server sent it that wait for an
 * answer.
 */
export class ChannelSession {
  #tools: readonly PageTool[] = [];
  readonly #outbox: ToolCall[] = [];
  #wake: (() => void) | undefined;
  #pending = new Map<string, Answer>();
  readonly #onToolsChanged: (tools: readonly PageTool[]) => void;

  constructor(onToolsChanged: (tools: readonly PageTool[]) => void) {
    this.#onToolsChanged = onToolsChanged;
  }

  get tools(): readonly PageTool[] {
    return this.#tools;
  }

  /** The page or App Process reports its tools. */
  publishTools(tools: readonly PageTool[]) {
    this.#tools = tools;
    this.#onToolsChanged(tools);
  }

  /** Sends `call` to the other end and resolves with its answer. */
  call(call: ToolCall): Promise<ToolCallOutcome> {
    return new Promise((resolve) => {
      this.#pending.set(call.callId, resolve);
      this.#outbox.push(call);
      const resolveWait = this.#wake;
      this.#wake = undefined;
      resolveWait?.();
    });
  }

  /** The other end answers a call; an answer to no pending call is ignored. */
  answer(outcome: ToolCallOutcome) {
    const resolve = this.#pending.get(outcome.callId);
    this.#pending.delete(outcome.callId);
    resolve?.(outcome);
  }

  /**
   * Takes the calls the other end has not answered, for the server to
   * answer; its later answers to them are ignored.
   */
  takeUnanswered(): Map<string, Answer> {
    const pending = this.#pending;
    this.#pending = new Map();
    this.#outbox.length = 0;
    return pending;
  }

  /** The calls for the other end, in order, until `signal` aborts. */
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
 * One page connected to the server through the channel: which tab it is,
 * besides its tools and calls.
 */
export class PageSession extends ChannelSession {
  /** The id the tab keeps for its pairing across reloads and navigation. */
  readonly tab: string;
  /** The document's URL when it connected. */
  readonly url: string;
  /** Ends the page's channel and tells it another tab paired in its place. */
  readonly disconnect: () => void;
  /** The new document the page said it started loading, if any. */
  leaving: PageLeaving | undefined;

  constructor(
    hello: PageHello,
    disconnect: () => void,
    onToolsChanged: (tools: readonly PageTool[]) => void
  ) {
    super(onToolsChanged);
    this.tab = hello.tab;
    this.url = hello.url;
    this.disconnect = disconnect;
  }
}

/** One App Process connected to the server: the id it connects with. */
export class ProcessSession extends ChannelSession {
  /** The id the App Process keeps across reconnects. */
  readonly id: string;
  /**
   * The id of the Node process or worker it runs in, which outlives the
   * connection; its connection id where it sends none.
   */
  readonly boot: string;

  constructor(
    hello: ProcessHello,
    onToolsChanged: (tools: readonly PageTool[]) => void
  ) {
    super(onToolsChanged);
    this.id = hello.process;
    this.boot = hello.boot ?? hello.process;
  }
}

/** What holds a tool and takes its calls: the page, or an App Process. */
type ToolHolder = PageSession | ProcessSession;

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
 * server, if any, the App Processes paired beside it, their tools, and
 * calls to them.
 *
 * A page belongs to a tab, which keeps its id across reloads and
 * navigation. The newest tab wins: when another tab connects, the paired
 * tab's calls are answered, it is disconnected, and it may not connect
 * again. An App Process never replaces the page or another App Process,
 * and the page never replaces it (ADR-0033).
 *
 * The agent sees one tool per name: the page's, else that of the App
 * Process that connected first among those that offer it, and each call
 * goes to that connection. Every call gets one answer: its connection's,
 * or the server's when the connection left first (see
 * `unansweredCallText`).
 */
export class AgentConnection {
  #page: PageSession | undefined;
  /** In the order they connected, which decides who keeps a name. */
  readonly #processes = new Map<string, ProcessSession>();
  #away: Away | undefined;
  readonly #replacedTabs = new Set<string>();
  /** The Node processes of the App Processes the agent called, by boot id. */
  readonly #calledProcesses = new Set<string>();
  /** The tool names the agent reached those App Processes through. */
  readonly #calledProcessTools = new Set<string>();
  #nextCallId = 1;
  readonly #listeners = new Set<(event: ConnectionEvent) => void>();

  /** The tools the agent sees: the page's, then the App Processes'. */
  get tools(): readonly PageTool[] {
    return this.#merged().shown.map(({ tool }) => tool);
  }

  /**
   * The App Processes' tools the agent sees, without the page's, as the
   * page's Inspector shows them.
   */
  get processTools(): readonly PageTool[] {
    return this.#merged()
      .shown.filter(({ holder }) => holder instanceof ProcessSession)
      .map(({ tool }) => tool);
  }

  /**
   * The names of the reported tools the agent does not see, because an
   * earlier App Process offers the same name.
   */
  get hidden(): readonly string[] {
    return this.#merged().hidden.map(({ name }) => name);
  }

  /** Whether a page is paired. */
  get paired(): boolean {
    return this.#page !== undefined;
  }

  /** Whether a page or any App Process is paired. */
  get connected(): boolean {
    return this.paired || this.#processes.size > 0;
  }

  /** Whether the agent sees a tool `name`. */
  offers(name: string): boolean {
    return this.#holderOf(name) !== undefined;
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
      this.#emit({ type: "toolsChanged", tools: this.tools });
    });
    this.#page = page;
    this.#emit({ type: "paired" });
    return page;
  }

  /**
   * An App Process introduced itself on a channel the server accepted. It
   * pairs beside the page and the other App Processes; an earlier session
   * of the same App Process, whose channel may not have closed yet, is
   * gone. `hiddenToolLists` tells it which of its tools the agent does not
   * see.
   */
  attachProcess(hello: ProcessHello): ProcessSession {
    const previous = this.#processes.get(hello.process);
    if (previous) this.detach(previous);
    const session: ProcessSession = new ProcessSession(hello, () => {
      if (this.#processes.get(session.id) !== session) return;
      this.#emit({ type: "toolsChanged", tools: this.tools });
    });
    this.#processes.set(session.id, session);
    this.#emit({ type: "processPaired" });
    return session;
  }

  /**
   * A page's or App Process's channel closed. An App Process's tools go at
   * once, and its calls are answered. For a page, the server waits up to `RECONNECT_WAIT_MS` for
   * its tab to reconnect, calls in flight or not, and stays busy with that
   * tab meanwhile; the calls are answered when it reconnects or the wait
   * ends.
   */
  detach(session: PageSession | ProcessSession) {
    if (session instanceof ProcessSession) return this.#detachProcess(session);
    const page = session;
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

  /**
   * Runs the tool `name` on the connection that offers it, or on the page
   * when none does, which answers for a name it doesn't know. Throws when
   * no connection offers it and no page is paired.
   */
  call(name: string, input: unknown): Promise<ToolCallOutcome> {
    const holder = this.#holderOf(name) ?? this.#page;
    if (!holder) throw new Error(`No connection offers the tool "${name}".`);
    const callId = String(this.#nextCallId++);
    return holder.call({ callId, name, input });
  }

  /**
   * Whether the agent's call to `name` is its first to an App Process that
   * takes the place of one it called before under one of the same tool
   * names, as when the app's server process restarted: its state in memory
   * started over. True once per Node process; an App Process that connects
   * again, or is stopped and started, in the same Node process is the same
   * one. Only the names the
   * agent reaches an App Process through count, not those it hides.
   */
  takeRestarted(name: string): boolean {
    const holder = this.#holderOf(name);
    if (!(holder instanceof ProcessSession)) return false;
    const names = this.#merged()
      .shown.filter((shown) => shown.holder === holder)
      .map(({ tool }) => tool.name);
    const first = !this.#calledProcesses.has(holder.boot);
    const restarted =
      first && names.some((tool) => this.#calledProcessTools.has(tool));
    this.#calledProcesses.add(holder.boot);
    for (const tool of names) this.#calledProcessTools.add(tool);
    return restarted;
  }

  /**
   * The App Processes' tools, at once and after each change to them, until
   * `signal` aborts. Changes that come faster than they are taken give
   * only the newest list.
   */
  processToolLists(
    signal: AbortSignal | undefined
  ): AsyncGenerator<readonly PageTool[]> {
    return this.#follow(() => this.processTools, signal);
  }

  /**
   * The tools of `session`, an App Process, that the agent does not see,
   * at once and after each change to them, until `signal` aborts: whether
   * it reported them after the App Process that keeps their names, or
   * that one reported them later. Changes that come faster than they are
   * taken give only the newest list.
   */
  hiddenToolLists(
    session: ProcessSession,
    signal: AbortSignal | undefined
  ): AsyncGenerator<readonly string[]> {
    return this.#follow(
      () =>
        this.#merged()
          .hidden.filter(({ holder }) => holder === session)
          .map(({ name }) => name),
      signal
    );
  }

  /** What `read` gives, at once and after each change, until `signal` aborts. */
  async *#follow<T>(
    read: () => T,
    signal: AbortSignal | undefined
  ): AsyncGenerator<T> {
    let wake: (() => void) | undefined;
    const rouse = () => {
      const resolve = wake;
      wake = undefined;
      resolve?.();
    };
    const unsubscribe = this.subscribe(rouse);
    signal?.addEventListener("abort", rouse, { once: true });
    try {
      let given: string | undefined;
      while (!signal?.aborted) {
        const value = read();
        const key = JSON.stringify(value);
        if (key !== given) {
          given = key;
          yield value;
        } else await new Promise<void>((resolve) => (wake = resolve));
      }
    } finally {
      unsubscribe();
      signal?.removeEventListener("abort", rouse);
    }
  }

  /**
   * Runs the tool `name` on the App Process that offers it, for the page,
   * whose Inspector runs App Process tools through the server. It never
   * goes to the page itself; with no App Process offering `name`, it
   * answers that none does.
   */
  callProcess(name: string, input: unknown): Promise<ToolCallOutcome> {
    const callId = String(this.#nextCallId++);
    const holder = this.#holderOf(name);
    if (!(holder instanceof ProcessSession))
      return Promise.resolve({
        callId,
        ok: false,
        error: `No App Process offers the tool "${name}".`,
      });
    return holder.call({ callId, name, input });
  }

  /**
   * The server stops: every call still waiting is answered, and no page is
   * paired any more.
   */
  close() {
    for (const process of this.#processes.values())
      answerUnanswered(process.takeUnanswered(), { type: "stopped" });
    if (this.#processes.size > 0) {
      this.#processes.clear();
      this.#emit({ type: "processUnpaired" });
    }
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

  #detachProcess(session: ProcessSession) {
    if (this.#processes.get(session.id) !== session) return;
    this.#processes.delete(session.id);
    answerUnanswered(session.takeUnanswered(), { type: "processLeft" });
    this.#emit({ type: "processUnpaired" });
  }

  /**
   * The tools the agent sees, each with the connection a call to it goes
   * to, and the offers it does not see. Each name goes to the first
   * connection that offers it: the page, then the App Processes in the
   * order they connected.
   */
  #merged() {
    const shown: { tool: PageTool; holder: ToolHolder }[] = [];
    const hidden: { name: string; holder: ToolHolder }[] = [];
    const taken = new Set<string>();
    const holders = [this.#page, ...this.#processes.values()];
    for (const holder of holders)
      for (const tool of holder?.tools ?? [])
        if (taken.has(tool.name))
          hidden.push({ name: tool.name, holder: holder! });
        else {
          taken.add(tool.name);
          shown.push({ tool, holder: holder! });
        }
    return { shown, hidden };
  }

  #holderOf(name: string): ToolHolder | undefined {
    return this.#merged().shown.find(({ tool }) => tool.name === name)?.holder;
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
