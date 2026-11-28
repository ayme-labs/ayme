// Why a dialog nobody answered stops an action: ADR-0073.
import { AsyncLocalStorage } from "node:async_hooks";

import {
  dialogOpenAtRun,
  showsWindow,
  type Dialog,
  type TabDialog,
} from "../../session/domain";

/** How long a dialog stays open before it counts as open. Some browser
 * automation accepts an alert by itself at once, and an action may answer
 * its own dialog: a Run whose dialog is gone by then goes on as if nothing
 * happened. */
export const DIALOG_OPEN_MS = 100;

/** What the project's Node Host asks of its Host about a Page Object
 * Action's own Playwright calls: `ActionCalls` of `@ayme-dev/ayme`. */
export type ActionCalls = {
  run<T>(action: () => T): T;
  before(answersAtOnce: boolean): Promise<void> | undefined;
  bind<F extends (...args: never[]) => unknown>(listener: F): F;
  stopped(): Promise<never> | undefined;
};

/** Whether the dialog stopped a request, once one did, and the promise
 * that then fails with what its Caller was answered, and whether an action
 * started in it: everything the Host does for the request carries the same
 * record. */
type Stop = {
  stopped: boolean;
  acted: boolean;
  readonly why: Promise<never>;
  readonly stop: (dialog: Dialog) => void;
};

const stopRecord = (): Stop => {
  let fail: (why: Error) => void = () => {};
  const why = new Promise<never>((_, reject) => (fail = reject));
  why.catch(() => {});
  const record: Stop = {
    stopped: false,
    acted: false,
    why,
    stop: (dialog) => {
      if (record.stopped) return;
      record.stopped = true;
      fail(new Error(dialogOpenAtRun(dialog)));
    },
  };
  return record;
};

const REFUSED =
  "ayme refused this Playwright call: the action stopped at a dialog it did not answer itself.";

const UNWATCHED =
  "ayme refused this Playwright call: ayme no longer watches the tab's dialogs, as the tab closed or the Session ended.";

const startAfter = (ms: number, then: () => void) => {
  const timer = setTimeout(then, ms);
  return () => clearTimeout(timer);
};

/**
 * The dialogs of one Tab, told to `tell` as the Session counts them (rule
 * 4), on `wait`'s clock, which a test moves. While one opens, the calls of
 * the actions under way wait, as it may close before it counts; once it
 * counts, the requests under way stop. ayme's own reads of the page are no
 * action's, so neither happens to them.
 */
export function tabDialogs(
  tell: (now: TabDialog) => void,
  wait: (ms: number, then: () => void) => () => void = startAfter,
  openMs = DIALOG_OPEN_MS
) {
  const requests = new AsyncLocalStorage<Stop>();
  const actions = new AsyncLocalStorage<Stop>();
  const running = new Set<Stop>();
  let now: TabDialog = "none";
  let counting: (() => void) | undefined;
  let ended = false;
  let held:
    { readonly until: Promise<void>; readonly end: () => void } | undefined;
  const set = (next: TabDialog) => {
    now = next;
    tell(next);
  };
  const release = () => {
    held?.end();
    held = undefined;
  };
  const count = (dialog: Dialog) => {
    counting = undefined;
    for (const stop of running) stop.stop(dialog);
    set({ open: dialog });
    release();
  };
  const whileRunning = <T>(stop: Stop, work: () => T): T => {
    running.add(stop);
    const ended = () => running.delete(stop);
    try {
      const value = work();
      void Promise.resolve(value).then(ended, ended);
      return value;
    } catch (error) {
      ended();
      throw error;
    }
  };
  const refuseIfStopped = (stop: Stop) => {
    // Work that goes on while a dialog counts as open is stopped too.
    if (typeof now === "object") stop.stop(now.open);
    if (stop.stopped) throw new Error(REFUSED);
  };
  const actionCalls: ActionCalls = {
    run: (action) => {
      // A child Run's action, or the action of a request, is stopped with
      // its parent or its request.
      const stop = actions.getStore() ?? requests.getStore();
      if (stop) {
        stop.acted = true;
        refuseIfStopped(stop);
        return actions.run(stop, action);
      }
      const own = stopRecord();
      refuseIfStopped(own);
      return whileRunning(own, () => actions.run(own, action));
    },
    before: (answersAtOnce) => {
      const own = actions.getStore();
      if (!own) return undefined;
      if (ended) throw new Error(UNWATCHED);
      refuseIfStopped(own);
      if (!held || answersAtOnce) return undefined;
      // A held call asks again once it wakes: the dialog may have counted
      // meanwhile, or the Tab's watch ended.
      return held.until.then(() => actionCalls.before(false));
    },
    stopped: () => (actions.getStore() ?? requests.getStore())?.why,
    // Playwright calls a listener from its connection, whose async context
    // is not the action's.
    bind: (listener) => {
      if (!actions.getStore()) return listener;
      const inAction = AsyncLocalStorage.snapshot();
      return ((...args) =>
        inAction(() => listener(...args))) as typeof listener;
    },
  };
  return {
    opened: (dialog: Dialog) => {
      if (ended) return;
      counting?.();
      if (!held) {
        let end = () => {};
        held = { until: new Promise<void>((resolve) => (end = resolve)), end };
      }
      set("opening");
      counting = wait(openMs, () => count(dialog));
    },
    /** The browser says `dialog` was open before the Tab was watched: it
     * counts at once, as nobody knows how long it has been open. */
    alreadyOpen: (dialog: Dialog) => {
      if (ended) return;
      counting?.();
      count(dialog);
    },
    closed: () => {
      if (ended) return;
      counting?.();
      counting = undefined;
      set("none");
      release();
    },
    /** The Tab is no longer watched, as its page closed: nothing more
     * counts, and the action calls it held are refused. */
    end: () => {
      ended = true;
      counting?.();
      counting = undefined;
      release();
    },
    /** Runs `work`, all the Host does for one request on the Tab: a
     * dialog that counts while it is under way stops it. `work` is handed
     * whether an action started in the request so far, as the project's
     * Node Host runs each Page Object Action's method through
     * `actionCalls.run`. */
    request: <T>(work: (acted: () => boolean) => T): T => {
      const stop = stopRecord();
      return requests.run(stop, () =>
        whileRunning(stop, () => work(() => stop.acted))
      );
    },
    actionCalls,
  };
}

/** The dialog that counts as open on one of the tabs `beside` a Tab, each
 * at its URL with its dialog if the Session watches it, with that tab's
 * URL: the first that has one. A tab that shows the Inspector window served
 * at `window` is no Tab. */
export function dialogBeside(
  beside: readonly {
    readonly url: string;
    readonly dialog: TabDialog | undefined;
  }[],
  window: string | undefined
): { readonly url: string; readonly dialog: Dialog } | undefined {
  for (const { url, dialog } of beside) {
    if (window !== undefined && showsWindow(url, window)) continue;
    if (typeof dialog === "object") return { url, dialog: dialog.open };
  }
  return undefined;
}
