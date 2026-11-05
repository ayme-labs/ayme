import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MonotonicTimeMsSchema } from "../capture/MonotonicTimeMs";
import type { PageActivitySource } from "./PageActivitySource";
import { waitForSettled } from "./waitForSettled";

describe("waitForSettled", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("resolves stable true once no activity was reported for quietMs from the call", async () => {
    const { clock, activity, advance } = createHarness();
    const result = waitForSettled({
      activity,
      clock,
      quietMs: 250,
      deadlineMs: 2_000,
    });

    await advance(250);
    await expect(result).resolves.toEqual({
      stable: true,
      reason: "quiet",
      settledAfterMs: 250,
    });
  });

  it("restarts the quiet window when activity is reported", async () => {
    const { clock, activity, emit, advance } = createHarness();
    const result = waitForSettled({
      activity,
      clock,
      quietMs: 250,
      deadlineMs: 2_000,
    });

    await advance(200);
    emit();
    await advance(200);
    await advance(49);
    expect(vi.getTimerCount()).toBeGreaterThan(0);

    await advance(1);
    await expect(result).resolves.toEqual({
      stable: true,
      reason: "quiet",
      settledAfterMs: 450,
    });
  });

  it("resolves stable false when the deadline passes first", async () => {
    const { clock, activity, emit, advance } = createHarness();
    const result = waitForSettled({
      activity,
      clock,
      quietMs: 250,
      deadlineMs: 2_000,
    });

    for (let at = 0; at < 1_900; at += 100) {
      await advance(100);
      emit();
    }
    await advance(100);
    await expect(result).resolves.toEqual({
      stable: false,
      reason: "deadline",
      settledAfterMs: 2_000,
    });
  });

  it("subscribes on call and unsubscribes when it resolves", async () => {
    const subscribe = vi.fn<(onActivity: () => void) => () => void>();
    const unsubscribe = vi.fn();
    subscribe.mockReturnValue(unsubscribe);
    const activity: PageActivitySource = { subscribe };
    let now = 0;
    const clock = { now: () => MonotonicTimeMsSchema.parse(now) };
    const result = waitForSettled({
      activity,
      clock,
      quietMs: 250,
      deadlineMs: 2_000,
    });

    expect(subscribe).toHaveBeenCalledOnce();
    expect(unsubscribe).not.toHaveBeenCalled();

    now = 250;
    await vi.advanceTimersByTimeAsync(250);
    await result;

    expect(unsubscribe).toHaveBeenCalledOnce();
  });

  it("reschedules when the timer fires before the clock reaches quietMs", async () => {
    const listeners = new Set<() => void>();
    let now = 0;
    const clock = { now: () => MonotonicTimeMsSchema.parse(now) };
    const activity: PageActivitySource = {
      subscribe(onActivity) {
        listeners.add(onActivity);
        return () => listeners.delete(onActivity);
      },
    };

    const result = waitForSettled({
      activity,
      clock,
      quietMs: 250,
      deadlineMs: 2_000,
    });

    // Advance the timer by 250 ms but leave the clock short.
    now = 249;
    await vi.advanceTimersByTimeAsync(250);

    // The timer fired but clock.now() - lastActivityAt < quietMs.
    // Without the reschedule fix this would fall through and only the
    // deadline timer would remain, resolving { stable: false } at 2 s.
    now = 500;
    await vi.advanceTimersByTimeAsync(250);
    await expect(result).resolves.toEqual({
      stable: true,
      reason: "quiet",
      settledAfterMs: 500,
    });
  });

  describe("with an AbortSignal", () => {
    it("resolves aborted at once, unsubscribes and clears every timer", async () => {
      const { clock, activity, emit, advance, listenerCount } = createHarness();
      const controller = new AbortController();
      const result = waitForSettled({
        activity,
        clock,
        quietMs: 250,
        deadlineMs: 2_000,
        signal: controller.signal,
      });

      await advance(100);
      emit();
      await advance(50);
      controller.abort();

      await expect(result).resolves.toEqual({
        stable: false,
        reason: "aborted",
        settledAfterMs: 150,
      });
      expect(listenerCount()).toBe(0);
      expect(vi.getTimerCount()).toBe(0);
    });

    it("resolves aborted without subscribing when the signal is already aborted", async () => {
      const subscribe = vi.fn<(onActivity: () => void) => () => void>();
      const clock = { now: () => MonotonicTimeMsSchema.parse(0) };

      const result = waitForSettled({
        activity: { subscribe },
        clock,
        quietMs: 250,
        deadlineMs: 2_000,
        signal: AbortSignal.abort(),
      });

      await expect(result).resolves.toEqual({
        stable: false,
        reason: "aborted",
        settledAfterMs: 0,
      });
      expect(subscribe).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
    });

    it("keeps the first outcome when the signal aborts after it resolved", async () => {
      const { clock, activity, advance } = createHarness();
      const controller = new AbortController();
      const result = waitForSettled({
        activity,
        clock,
        quietMs: 250,
        deadlineMs: 2_000,
        signal: controller.signal,
      });

      await advance(250);
      controller.abort();

      await expect(result).resolves.toMatchObject({ reason: "quiet" });
    });

    it("cleans up when the signal aborts while subscribing", async () => {
      const controller = new AbortController();
      const unsubscribe = vi.fn();
      const clock = { now: () => MonotonicTimeMsSchema.parse(0) };

      const result = waitForSettled({
        activity: {
          subscribe: () => {
            controller.abort();
            return unsubscribe;
          },
        },
        clock,
        quietMs: 250,
        deadlineMs: 2_000,
        signal: controller.signal,
      });

      await expect(result).resolves.toMatchObject({ reason: "aborted" });
      expect(unsubscribe).toHaveBeenCalledOnce();
      expect(vi.getTimerCount()).toBe(0);
    });

    it("rejects with the subscription error and leaves no timer or listener behind", async () => {
      const signal = new AbortController().signal;
      const removeEventListener = vi.spyOn(signal, "removeEventListener");
      const failure = new Error("cannot subscribe");
      const clock = { now: () => MonotonicTimeMsSchema.parse(0) };

      const result = waitForSettled({
        activity: {
          subscribe: () => {
            throw failure;
          },
        },
        clock,
        quietMs: 250,
        deadlineMs: 2_000,
        signal,
      });

      await expect(result).rejects.toBe(failure);
      expect(vi.getTimerCount()).toBe(0);
      expect(removeEventListener).toHaveBeenCalledWith(
        "abort",
        expect.any(Function)
      );
    });

    it("stops listening to the signal once it resolved", async () => {
      const { clock, activity, advance } = createHarness();
      const signal = new AbortController().signal;
      const removeEventListener = vi.spyOn(signal, "removeEventListener");
      const result = waitForSettled({
        activity,
        clock,
        quietMs: 250,
        deadlineMs: 2_000,
        signal,
      });

      await advance(250);
      await result;

      expect(removeEventListener).toHaveBeenCalledWith(
        "abort",
        expect.any(Function)
      );
    });
  });
});

function createHarness() {
  let now = 0;
  const listeners = new Set<() => void>();
  const clock = {
    now: () => MonotonicTimeMsSchema.parse(now),
  };
  const activity: PageActivitySource = {
    subscribe(onActivity) {
      listeners.add(onActivity);
      return () => listeners.delete(onActivity);
    },
  };
  const emit = () => {
    for (const listener of listeners) listener();
  };
  const advance = async (ms: number) => {
    now += ms;
    await vi.advanceTimersByTimeAsync(ms);
  };
  return {
    clock,
    activity,
    emit,
    advance,
    listenerCount: () => listeners.size,
    now: () => now,
  };
}
