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

/** What the project's Node Host asks of its Host about a Page Object
 * Action's own Playwright calls: `ActionCalls` of `@ayme-dev/ayme`. */
export type ActionCalls = {
  run<T>(action: () => T): T;
  before(answersAtOnce: boolean): Promise<void> | undefined;
};

/** A Page Object Action under way on the Tab, and the dialog that stopped
 * it, once one did. */
type Action = { stoppedBy?: Dialog };

const REFUSED =
  "ayme refused this Playwright call: the action stopped at a dialog it did not answer itself.";

const startAfter = (ms: number, then: () => void) => {
  const timer = setTimeout(then, ms);
  return () => clearTimeout(timer);
};

/**
 * The dialogs of one Tab, as the browser says each opens and closes, told
 * to `tell` as the Session counts them: "opening" at once, open once
 * {@link DIALOG_OPEN_MS} passed on `wait`'s clock. While one opens, the
 * calls that reach the browser of each action under way wait; once one
 * counts as open, the actions under way are stopped: each later call of
 * theirs is refused, however the dialog is answered. A call outside every
 * action, such as ayme's own read of the page, is neither.
 */
export function tabDialogs(
  tell: (now: TabDialog) => void,
  wait: (ms: number, then: () => void) => () => void = startAfter
) {
  const actions = new AsyncLocalStorage<Action>();
  const running = new Set<Action>();
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
  const actionCalls: ActionCalls = {
    run: (action) => {
      const own: Action = {};
      running.add(own);
      const ended = () => running.delete(own);
      try {
        const value = actions.run(own, action);
        void Promise.resolve(value).then(ended, ended);
        return value;
      } catch (error) {
        ended();
        throw error;
      }
    },
    before: (answersAtOnce) => {
      const own = actions.getStore();
      if (!own) return undefined;
      // An action that starts while a dialog counts as open is stopped too.
      if (typeof now === "object") own.stoppedBy ??= now.open;
      if (own.stoppedBy) throw new Error(REFUSED);
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
      counting = wait(DIALOG_OPEN_MS, () => {
        counting = undefined;
        for (const action of running) action.stoppedBy ??= dialog;
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
    actionCalls,
  };
}
