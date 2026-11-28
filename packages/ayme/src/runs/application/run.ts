import type { Page } from "@playwright/test";
import type { Cursor } from "../../page-state/domain";
import type {
  Navigation,
  PageStateSession,
  Reach,
} from "../../page-state/application";
import type { PomDefinitionsResult } from "../../shared";
import { callers, RuntimeStateError, type Caller } from "../../shared";

/**
 * What a Host decides about the Playwright calls of a Page Object Action's
 * own code, told apart from ayme's own reads of the page. A Session holds
 * them while a dialog opens on its Tab and refuses them once one counts as
 * open: an action never goes on past a dialog it did not answer itself
 * (ADR-0073).
 */
export type ActionCalls = {
  /** Runs a Page Object Action's method: the calls its code makes, at once
   * or later, are the action's own. Throws, without running it, to refuse
   * the action. */
  run<T>(action: () => T): T;
  /**
   * Heard before each call through the runtime's Page, its locators and
   * input devices, whoever makes it. Returns nothing to let the call start
   * now, a promise to start it once that resolves, or throws to refuse it.
   * A call that `answersAtOnce`, such as building a locator, cannot wait.
   */
  before(answersAtOnce: boolean): Promise<void> | undefined;
  /** `listener`, which an action hands Playwright to call later, made to
   * run as that action's own code wherever Playwright calls it from. */
  bind<F extends (...args: never[]) => unknown>(listener: F): F;
  /** For the Run whose code asks, a promise that fails with what its
   * Caller was answered instead once the Host stopped the Run; undefined
   * for a Run the Host does not stop. */
  stopped(): Promise<never> | undefined;
};

/** How `ayme.tools.run` starts a Run. */
export type ToolRunOptions = {
  /** The Run's Caller; `"app"` when absent. */
  by?: Caller;
};

/**
 * Package-internal: what a tool's execution is handed. `cursor` is the
 * Change Record cursor the Run reads from and moves: its Caller's for a
 * top-level Run, the parent's for a child Run.
 */
export type RunContext = {
  readonly cursor: Cursor;
  /** Starts a child Run of this Run. */
  readonly run: StartChildRun;
  /** The browser Page the Run acts on: its runtime session's, child Runs included. */
  readonly page: Page;
  /** How the Run moves its page and tells where it is: the page's URL and history. */
  readonly navigation: Navigation;
  /**
   * The application's router navigation, when the runtime session was given
   * one: the `navigate` tool hands it the resolved URL instead of loading a
   * new document.
   */
  readonly routerNavigate?: (url: string) => unknown;
  /** The definitions of the Page Object classes the Run's page registered, for `names` or all. */
  pomDefinitions(...names: readonly string[]): PomDefinitionsResult;
  /**
   * The Page Object Tree of the Run's page now, as the text `page_objects`
   * answers: its Page Objects, their declared children and their ids.
   */
  pageObjectTree(): Promise<string>;
  /** The Page State Session of the Run's page: its actions, captures and refs go through it. */
  readonly pageStateSession: PageStateSession;
  /** How the Run measures whether its input would reach an element: the runtime's Reach. */
  readonly reach: Reach;
  /**
   * Whether the Run's runtime session goes on in the document a full load
   * brings, as a Node host's does; the browser runtime's ends with its
   * document.
   */
  readonly outlivesFullLoads: boolean;
  /** What its Host decides about its Page Object Action's own Playwright
   * calls, when it decides. */
  readonly actionCalls?: ActionCalls;
};

/**
 * Package-internal: starts the live tool `name` as a child Run of the
 * current Run, inside its turn, after the child Runs it started before: it
 * never waits on the page's queue. Its Change Record reads from and moves
 * `cursor`, the parent Run's by default.
 */
export type StartChildRun = (
  name: string,
  input: unknown,
  cursor?: Cursor
) => Promise<unknown>;

/**
 * Package-internal: the Caller `options` names, `app` when it names none.
 * Throws `RuntimeStateError` for an empty name.
 */
export function callerOf(options: ToolRunOptions | undefined): Caller {
  const by = options?.by ?? callers.app;
  if (typeof by !== "string" || by === "")
    throw new RuntimeStateError(
      "A Run needs a Caller: `by` is empty or not a string."
    );
  return by;
}

/**
 * Package-internal: a queue of Runs, a page's top-level Runs or one Run's
 * child Runs. Each Run's turn starts once the turn before it has ended,
 * whether that Run succeeded or failed. A top-level Run's turn is all of
 * `turn`: an action's settle included, a read's without one. A Run inside
 * another Run's turn must not take a turn on the queue that Run waits in:
 * it would wait behind the Run it is part of.
 */
export type RunQueue = <T>(turn: () => Promise<T>) => Promise<T>;

/** Package-internal: an empty `RunQueue`, one per page and one per Run's children. */
export function createRunQueue(): RunQueue {
  let last: Promise<unknown> = Promise.resolve();
  return (turn) => {
    const ran = last.then(turn);
    last = ran.catch(() => {});
    return ran;
  };
}

/**
 * Package-internal: `execute` a top-level Run, then `settle` before
 * resolving, whether it succeeded or failed; a child Run adds no settle wait
 * of its own. A read (`snapshot`, `page_objects`, a Peek Tool: the caller says which) skips
 * the settle, and so does an answer saying a full page load started: it goes
 * out at once, before the document goes away.
 */
export async function executeTopLevelRun<T>(
  { reads }: { reads: boolean },
  execute: () => Promise<T>,
  settle: () => Promise<void>
): Promise<T> {
  if (reads) return execute();
  let result: T;
  try {
    result = await execute();
  } catch (error) {
    if (!failedAfterFullLoad(error)) await settle();
    throw error;
  }
  if (!startedFullLoad(result)) await settle();
  return result;
}

const afterFullLoad = new WeakSet<object>();

/** Package-internal: marks `error` as what an action threw after the full
 * load it started, on a Host that outlives the load. Nothing reads the page
 * for it, as nothing does for an answer after a full load. */
export function markFailedAfterFullLoad(error: unknown): void {
  if (typeof error === "object" && error !== null) afterFullLoad.add(error);
}

/** Package-internal: whether `error` is one {@link markFailedAfterFullLoad}
 * marked. */
export const failedAfterFullLoad = (error: unknown): boolean =>
  typeof error === "object" && error !== null && afterFullLoad.has(error);

/** Whether an answer, an action result or a Handover, names a loading URL. */
function startedFullLoad(answer: unknown): boolean {
  return (
    typeof answer === "object" &&
    answer !== null &&
    typeof (answer as { loading?: unknown }).loading === "string"
  );
}
