import type { Point } from "./preferences";

/**
 * The spring the panel and its logo move on: critically damped, so it
 * settles without bouncing, with the response Apple gives a move or a
 * reposition, in seconds. Played for `duration` ms, it ends within 0.13% of
 * where it's going: under a pixel across the widest dock change. The design
 * system's tokens.css carries it at rest as `--ease-spring` and
 * `--duration-spring`.
 */
export const spring = { response: 0.35, duration: 500 };

/** How far the easing's line may stray from the spring, as a share of the distance. */
const TOLERANCE = 0.001;

/** The spring's progress at a share of its duration. */
type SpringSample = { at: number; value: number };

/**
 * The spring as a CSS `linear()` easing over its duration. It starts with
 * `velocity`: how fast it already goes toward where it's going, as a share
 * of the distance per second, the way a drag hands its speed on. A velocity
 * away from there carries it back past its start before it turns.
 */
export function springEasing(velocity = 0): string {
  const omega = (2 * Math.PI) / spring.response;
  const progress = (seconds: number) =>
    1 - (1 + (omega - velocity) * seconds) * Math.exp(-omega * seconds);
  // A sample each millisecond, the last on the end itself.
  const samples = Array.from({ length: spring.duration + 1 }, (_, ms) => ({
    at: ms / spring.duration,
    value: ms === spring.duration ? 1 : progress(ms / 1000),
  }));
  const points = simplify(samples).map(({ at, value }, index, all) =>
    index === 0 || index === all.length - 1
      ? String(value)
      : `${round(value, 4)} ${round(at * 100, 1)}%`
  );
  return `linear(${points.join(", ")})`;
}

/**
 * The samples a line through them needs to keep within the tolerance of all
 * of them (Ramer–Douglas–Peucker): few where the spring is nearly straight.
 */
function simplify(samples: readonly SpringSample[]) {
  const kept = new Set([0, samples.length - 1]);
  const keepBetween = (from: number, to: number) => {
    const start = samples[from];
    const end = samples[to];
    let farthest = -1;
    let distance = TOLERANCE;
    for (let index = from + 1; index < to; index += 1) {
      const { at, value } = samples[index];
      const share = (at - start.at) / (end.at - start.at);
      const off = Math.abs(
        value - (start.value + share * (end.value - start.value))
      );
      if (off > distance) {
        distance = off;
        farthest = index;
      }
    }
    if (farthest < 0) return;
    kept.add(farthest);
    keepBetween(from, farthest);
    keepBetween(farthest, to);
  };
  keepBetween(0, samples.length - 1);
  return samples.filter((_, index) => kept.has(index));
}

function round(value: number, digits: number) {
  return Number(value.toFixed(digits));
}

/** Where a drag was, and when, in ms. */
export type Sample = Point & { time: number };

/** How far back a drag's speed at release is measured, in ms. */
const RELEASE_WINDOW = 100;

/**
 * A drag's velocity as it lets go, in px/s: the way it went over its last
 * 100 ms, up to the release. A drag that slowed or stopped before letting go
 * hands on less, or none.
 */
export function releaseVelocity(
  samples: readonly Sample[],
  releasedAt: number
): Point {
  const recent = samples.filter(
    ({ time }) => releasedAt - time <= RELEASE_WINDOW
  );
  const first = recent[0];
  const last = recent.at(-1);
  if (!first || !last || last.time === first.time) return { x: 0, y: 0 };
  const seconds = (releasedAt - first.time) / 1000;
  return { x: (last.x - first.x) / seconds, y: (last.y - first.y) / seconds };
}
