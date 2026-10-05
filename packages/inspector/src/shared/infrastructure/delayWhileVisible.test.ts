import { afterEach, expect, it, vi } from "vitest";

import { delayWhileVisible } from "./delayWhileVisible";
import { hideDocument } from "../test-utils/visibility";

let show = () => {};

afterEach(() => {
  show();
  show = () => {};
  vi.useRealTimers();
});

it("waits its time while the document is visible", async () => {
  vi.useFakeTimers();
  const ended = vi.fn();
  void delayWhileVisible(500).then(ended);

  await vi.advanceTimersByTimeAsync(499);
  expect(ended).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  expect(ended).toHaveBeenCalledOnce();
});

it("ends at once while the document is hidden", async () => {
  vi.useFakeTimers();
  show = hideDocument();

  await delayWhileVisible(500);
  expect(vi.getTimerCount()).toBe(0);
});

it("ends when the document is hidden during the wait", async () => {
  vi.useFakeTimers();
  const ended = vi.fn();
  void delayWhileVisible(500).then(ended);
  await vi.advanceTimersByTimeAsync(100);

  show = hideDocument();
  await Promise.resolve();
  expect(ended).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
});
