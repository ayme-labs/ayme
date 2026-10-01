import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { createRefreshScheduler } from "./refreshScheduler";

// Unit tests: when the Inspector refreshes its view of the page while the
// page keeps changing. Timings are the scheduler's contract: a ~200 ms
// trailing debounce, at most ~1 s of waiting, one refresh at a time.

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

it("refreshes once, 200 ms after a burst of changes ends", async () => {
  const refresh = vi.fn(async () => {});
  const scheduler = createRefreshScheduler(refresh);

  scheduler.request();
  await vi.advanceTimersByTimeAsync(100);
  scheduler.request();
  await vi.advanceTimersByTimeAsync(100);
  scheduler.request();
  await vi.advanceTimersByTimeAsync(199);
  expect(refresh).not.toHaveBeenCalled();

  await vi.advanceTimersByTimeAsync(1);
  expect(refresh).toHaveBeenCalledOnce();
});

it("refreshes within a second while the page never stops changing", async () => {
  const refresh = vi.fn(async () => {});
  const scheduler = createRefreshScheduler(refresh);

  for (let elapsed = 0; elapsed < 1000; elapsed += 100) {
    scheduler.request();
    await vi.advanceTimersByTimeAsync(100);
  }

  expect(refresh).toHaveBeenCalledOnce();
});

it("runs one refresh at a time, and one more for changes made meanwhile", async () => {
  let finish = () => {};
  const refresh = vi.fn(
    () => new Promise<void>((resolve) => (finish = resolve))
  );
  const scheduler = createRefreshScheduler(refresh);
  scheduler.request();
  await vi.advanceTimersByTimeAsync(200);
  expect(refresh).toHaveBeenCalledOnce();

  scheduler.request();
  scheduler.request();
  await vi.advanceTimersByTimeAsync(2000);
  expect(refresh).toHaveBeenCalledOnce();

  finish();
  await vi.advanceTimersByTimeAsync(200);
  expect(refresh).toHaveBeenCalledTimes(2);
  finish();
  await vi.advanceTimersByTimeAsync(2000);
  expect(refresh).toHaveBeenCalledTimes(2);
});

it("stops refreshing once disposed", async () => {
  const refresh = vi.fn(async () => {});
  const scheduler = createRefreshScheduler(refresh);

  scheduler.request();
  scheduler.dispose();
  await vi.advanceTimersByTimeAsync(2000);

  expect(refresh).not.toHaveBeenCalled();
});
