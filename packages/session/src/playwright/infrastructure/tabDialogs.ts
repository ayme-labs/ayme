// A Tab's dialogs as a Session counts them (rule 4), and the Playwright
// calls of the Page Object Actions on the Tab, which a dialog nobody
// answered stops (ADR-0073).
import { AsyncLocalStorage } from "node:async_hooks";

import type { Dialog, TabDialog } from "../../session/domain";

/** How long a dialog stays open before it counts as open. Some browser
 * automation accepts an alert by itself at once, and an action may answer
 * its own dialog: a Run whose dialog is gone by then goes on as if nothing
 * happened. */
export const DIALOG_OPEN_MS = 100;

/** {@link DIALOG_OPEN_MS}, unless `env` sets AYME_DIALOG_OPEN_MS to a
 * number of milliseconds: an end-to-end test sets a longer one, so that an
 * action that answers its own dialog does so in time on a slow machine. */
export function dialogOpenMs(env: NodeJS.ProcessEnv): number {
  const ms = Number(env["AYME_DIALOG_OPEN_MS"]);
  return Number.isFinite(ms) && ms > 0 ? ms : DIALOG_OPEN_MS;
}

/** What the project's Node Host asks of its Host about a Page Object
 * Action's own Playwright calls: `ActionCalls` of `@ayme-dev/ayme`. */
export type ActionCalls = {
  run<T>(action: () => T): T;
  before(answersAtOnce: boolean): Promise<void> | undefined;
};

/** Whether the dialog stopped a request, once one did: everything the Host
 * does for it carries the same record. */
type Stop = { stopped: boolean };

const REFUSED =
  "ayme refused this Playwright call: the action stopped at a dialog it did not answer itself.";

const startAfter = (ms: number, then: () => void) => {
  const timer = setTimeout(then, ms);
  return () => clearTimeout(timer);
};

/**
 * The dialogs of one Tab, as the browser says each opens and closes, told
 * to `tell` as the Session counts them: "opening" at once, open once
 * `openMs` passed on `wait`'s clock. While one opens, the
 * calls that reach the browser of each action under way wait; once one
 * counts as open, the requests under way are stopped: their actions are
 * never entered, and each later call of theirs is refused, however the
 * dialog is answered. A call outside every action, such as ayme's own read
 * of the page, is neither.
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
    if (typeof now === "object") stop.stopped = true;
    if (stop.stopped) throw new Error(REFUSED);
  };
  const actionCalls: ActionCalls = {
    run: (action) => {
      // A child Run's action, or the action of a request, is stopped with
      // its parent or its request.
      const stop = actions.getStore() ?? requests.getStore();
      if (stop) {
        refuseIfStopped(stop);
        return actions.run(stop, action);
      }
      const own: Stop = { stopped: false };
      refuseIfStopped(own);
      return whileRunning(own, () => actions.run(own, action));
    },
    before: (answersAtOnce) => {
      const own = actions.getStore();
      if (!own) return undefined;
      refuseIfStopped(own);
      if (!held || answersAtOnce) return undefined;
      return held.until.then(() => actionCalls.before(false));
    },
  };
  return {
    /** The browser says `dialog` opened on the Tab's page. */
    opened: (dialog: Dialog) => {
      counting?.();
      if (!held) {
        let end = () => {};
        held = { until: new Promise<void>((resolve) => (end = resolve)), end };
      }
      set("opening");
      counting = wait(openMs, () => {
        counting = undefined;
        for (const stop of running) stop.stopped = true;
        set({ open: dialog });
        release();
      });
    },
    /** The browser says the Tab's dialog closed, whoever answered it. */
    closed: () => {
      counting?.();
      counting = undefined;
      set("none");
      release();
    },
    /** Runs `work`, all the Host does for one request on the Tab: a
     * dialog that counts while it is under way stops it. */
    request: <T>(work: () => T): T => {
      const stop: Stop = { stopped: false };
      return requests.run(stop, () => whileRunning(stop, work));
    },
    actionCalls,
  };
}
