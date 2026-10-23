import {
  MonotonicTimeMsSchema,
  type MonotonicClock,
} from "@ayme-dev/core/structural-observation";

export const browserMonotonicClock: MonotonicClock = {
  now: () => MonotonicTimeMsSchema.parse(performance.now()),
};
