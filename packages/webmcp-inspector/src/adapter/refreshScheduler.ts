/**
 * Coalesces refresh requests: a refresh runs once the requests pause for
 * `debounceMs`, or `maxWaitMs` after the first unserved request while they
 * keep coming. Only one refresh runs at a time; requests made while it runs
 * lead to one more refresh after it.
 */
export function createRefreshScheduler(
  refresh: () => Promise<void>,
  { debounceMs = 200, maxWaitMs = 1000 } = {}
) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let firstRequestAt: number | undefined;
  let running = false;
  let requestedWhileRunning = false;
  let disposed = false;

  const run = async () => {
    timer = undefined;
    firstRequestAt = undefined;
    running = true;
    try {
      await refresh();
    } catch {
      // The refresh reports its own errors; the schedule carries on.
    } finally {
      running = false;
      if (requestedWhileRunning && !disposed) {
        requestedWhileRunning = false;
        request();
      }
    }
  };

  function request() {
    if (disposed) return;
    if (running) {
      requestedWhileRunning = true;
      return;
    }
    const now = Date.now();
    firstRequestAt ??= now;
    if (timer !== undefined) clearTimeout(timer);
    const wait = Math.min(debounceMs, firstRequestAt + maxWaitMs - now);
    timer = setTimeout(() => void run(), Math.max(0, wait));
  }

  return {
    request,
    dispose() {
      disposed = true;
      if (timer !== undefined) clearTimeout(timer);
    },
  };
}
