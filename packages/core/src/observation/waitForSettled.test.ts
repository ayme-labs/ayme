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
    await expect(result).resolves.toEqual({ stable: true });
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
    await expect(result).resolves.toEqual({ stable: true });
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
    await expect(result).resolves.toEqual({ stable: false });
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
  return { clock, activity, emit, advance, now: () => now };
}
