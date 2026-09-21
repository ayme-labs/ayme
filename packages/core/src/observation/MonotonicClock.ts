import type { MonotonicTimeMs } from "../capture/MonotonicTimeMs";

export type MonotonicClock = {
  now(): MonotonicTimeMs;
};
