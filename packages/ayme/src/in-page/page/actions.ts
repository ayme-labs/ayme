// Stryker disable all
// Actions as the document's module runs them: the before capture, the
// Settled Page wait and the after capture, in the document, so a host pays
// no round trip while the page goes quiet. A full load that starts while an
// action is in flight ends it at once, with the old document's last capture.
import {
  SETTLED_PAGE_DEADLINE_MS,
  SETTLED_PAGE_QUIET_MS,
  waitForSettled,
  type MonotonicClock,
  type MonotonicTimeMs,
  type PageActivitySource,
} from "@ayme-dev/core/structural-observation";

import type { Capture } from "../../shared";
import type { ElementInputs } from "./capture";

type HostKey = string;

/**
 * What a host hands an action's captures, transitionally as live values in
 * the page (`ElementInputs`): given as a function, it is read again before
 * each capture, as the browser runtime's registry probes its roots then.
 */
export type ActionInputs =
  ElementInputs | (() => ElementInputs | Promise<ElementInputs>);

/** A begun action: its number in the document, and the page right before it. */
export type Begun = { action: number; before: Capture };

/**
 * How an action ended: the page settled, `stable` saying whether it went
 * quiet before the deadline, with the capture after it, or with why that
 * capture failed; or a full load of `loading` started first, with the old
 * document's last capture when it could take one.
 */
export type Settled =
  | { stable: boolean; after: Capture }
  | { stable: boolean; failed: string }
  | { loading: string; after?: Capture };

/** What the module tells the host of an action when a full load ends it. */
export type LoadStarted = {
  kind: "loading";
  action: number;
  url: string;
  after?: Capture;
};

type InFlight = {
  host: HostKey;
  /** The inputs of its before capture, for a capture when a load starts. */
  inputs: ElementInputs;
  loading?: { url: string; after?: Capture };
  /** Ends its Settled Page wait early. */
  stopWaiting?: () => void;
};

const clock: MonotonicClock = {
  now: () => performance.now() as MonotonicTimeMs,
};

/** The document's actions, waiting on `activity` and capturing with `capture`. */
export function createActions({
  activity,
  capture,
  tell,
}: {
  activity: PageActivitySource;
  capture(host: HostKey, inputs: ElementInputs): Capture;
  /** Tells `host` of a load that ended its action. */
  tell(host: HostKey, message: LoadStarted): void;
}) {
  const actions = new Map<number, InFlight>();
  let lastAction = 0;

  /** The answer of an action a full load ended, if one did. */
  const ended = ({ loading }: InFlight): Settled | undefined =>
    loading && {
      loading: loading.url,
      ...(loading.after && { after: loading.after }),
    };

  return {
    /** Captures the page for `host` and arms the full-load watch for its action. */
    async begin(host: HostKey, inputs?: ActionInputs): Promise<Begun> {
      const resolved = await read(inputs);
      const before = capture(host, resolved);
      const action = ++lastAction;
      actions.set(action, { host, inputs: resolved });
      return { action, before };
    },

    /**
     * Waits for a Settled Page after `host`'s `action` and captures it,
     * unless a full load ends the action first.
     */
    async settle(
      host: HostKey,
      action: number,
      inputs?: ActionInputs
    ): Promise<Settled> {
      const inFlight = actions.get(action);
      if (inFlight?.host !== host)
        throw new Error(`This host has no action ${action} in flight.`);
      try {
        const waiting = new AbortController();
        inFlight.stopWaiting = () => waiting.abort();
        const { stable } = inFlight.loading
          ? { stable: false }
          : await waitForSettled({
              activity,
              clock,
              quietMs: SETTLED_PAGE_QUIET_MS,
              deadlineMs: SETTLED_PAGE_DEADLINE_MS,
              signal: waiting.signal,
            });
        const loaded = ended(inFlight);
        if (loaded) return loaded;
        let after: Capture;
        try {
          const resolved = await read(inputs);
          // A load may start while the inputs are read.
          const loadedSince = ended(inFlight);
          if (loadedSince) return loadedSince;
          after = capture(host, resolved);
        } catch (error) {
          return {
            stable,
            failed: error instanceof Error ? error.message : String(error),
          };
        }
        return { stable, after };
      } finally {
        actions.delete(action);
      }
    },

    /**
     * A full load of `url` started: each action in flight ends with the
     * page as it is now, and its host hears of it at once.
     */
    loadStarted(url: string): void {
      for (const [action, inFlight] of actions) {
        if (inFlight.loading) continue;
        let after: Capture | undefined;
        try {
          after = capture(inFlight.host, inFlight.inputs);
        } catch {
          after = undefined;
        }
        inFlight.loading = after ? { url, after } : { url };
        inFlight.stopWaiting?.();
        tell(inFlight.host, { kind: "loading", action, ...inFlight.loading });
      }
    },
  };
}

async function read(inputs: ActionInputs | undefined): Promise<ElementInputs> {
  return (typeof inputs === "function" ? await inputs() : inputs) ?? {};
}
