import type { MonotonicClock } from "./MonotonicClock";
import type { PageActivitySource } from "./PageActivitySource";

export const SETTLED_PAGE_QUIET_MS = 250;
export const SETTLED_PAGE_DEADLINE_MS = 2_000;

export function waitForSettled(options: {
  activity: PageActivitySource;
  clock: MonotonicClock;
  quietMs: number;
  deadlineMs: number;
}): Promise<{ stable: boolean }> {
  const { activity, clock, quietMs, deadlineMs } = options;
  const startedAt = clock.now();

  return new Promise((resolve) => {
    let lastActivityAt = startedAt;
    let quietTimer: ReturnType<typeof setTimeout> | undefined;
    let finished = false;
    let unsubscribe = () => {};

    const finish = (stable: boolean) => {
      if (finished) return;
      finished = true;
      unsubscribe();
      if (quietTimer !== undefined) clearTimeout(quietTimer);
      clearTimeout(deadlineTimer);
      resolve({ stable });
    };

    const scheduleQuietCheck = () => {
      if (quietTimer !== undefined) clearTimeout(quietTimer);
      const remaining = quietMs - (clock.now() - lastActivityAt);
      if (remaining <= 0) {
        finish(true);
        return;
      }
      quietTimer = setTimeout(() => {
        if (clock.now() - lastActivityAt >= quietMs) finish(true);
      }, remaining);
    };

    unsubscribe = activity.subscribe(() => {
      lastActivityAt = clock.now();
      scheduleQuietCheck();
    });

    const deadlineTimer = setTimeout(() => finish(false), deadlineMs);
    scheduleQuietCheck();
  });
}
