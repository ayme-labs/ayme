import type { MonotonicClock } from "./MonotonicClock";
import type { PageActivitySource } from "./PageActivitySource";

export const SETTLED_PAGE_QUIET_MS = 250;
export const SETTLED_PAGE_DEADLINE_MS = 2_000;

/**
 * Resolves once `activity` has been quiet for `quietMs` (`reason: "quiet"`,
 * `stable: true`), when `deadlineMs` passes first (`"deadline"`), or when
 * `signal` aborts (`"aborted"`). Both of the latter report `stable: false`.
 * `settledAfterMs` is how long the wait took on `clock`. An abort
 * unsubscribes from `activity` and clears the timers at once.
 */
export function waitForSettled(options: {
  activity: PageActivitySource;
  clock: MonotonicClock;
  quietMs: number;
  deadlineMs: number;
  signal?: AbortSignal;
}): Promise<{
  stable: boolean;
  reason: "quiet" | "deadline" | "aborted";
  settledAfterMs: number;
}> {
  const { activity, clock, quietMs, deadlineMs, signal } = options;
  const startedAt = clock.now();

  return new Promise((resolve) => {
    let lastActivityAt = startedAt;
    let quietTimer: ReturnType<typeof setTimeout> | undefined;
    let finished = false;
    let unsubscribe = () => {};

    const onAbort = () => finish("aborted");

    const release = () => {
      try {
        unsubscribe();
      } finally {
        clearTimeout(quietTimer);
        clearTimeout(deadlineTimer);
        signal?.removeEventListener("abort", onAbort);
      }
    };

    const finish = (reason: "quiet" | "deadline" | "aborted") => {
      if (finished) return;
      finished = true;
      resolve({
        stable: reason === "quiet",
        reason,
        settledAfterMs: clock.now() - startedAt,
      });
      // After resolving, so an `unsubscribe` that throws cannot leave the wait pending.
      release();
    };

    const deadlineTimer = setTimeout(() => finish("deadline"), deadlineMs);

    if (signal?.aborted) {
      finish("aborted");
      return;
    }
    signal?.addEventListener("abort", onAbort);

    const scheduleQuietCheck = () => {
      if (finished) return;
      clearTimeout(quietTimer);
      const remaining = quietMs - (clock.now() - lastActivityAt);
      if (remaining <= 0) {
        finish("quiet");
        return;
      }
      // When it fires, activity may have moved the quiet window on: check again.
      quietTimer = setTimeout(scheduleQuietCheck, remaining);
    };

    try {
      unsubscribe = activity.subscribe(() => {
        lastActivityAt = clock.now();
        scheduleQuietCheck();
      });
    } catch (error) {
      release();
      throw error;
    }
    // The wait may have finished while subscribing, before `unsubscribe` was set.
    if (finished) unsubscribe();
    else scheduleQuietCheck();
  });
}
