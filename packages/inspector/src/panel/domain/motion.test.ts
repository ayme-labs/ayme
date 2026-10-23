import { describe, expect, it } from "vitest";
import css from "virtual:ayme-inspector-css";

import { releaseVelocity, spring, springEasing } from "./motion";

/** The progress a `linear()` easing reaches at a share of its duration. */
function progressAt(easing: string, at: number) {
  const parts = easing.replace(/^linear\(|\)$/g, "").split(", ");
  const points = parts.map((part, index) => {
    const [value, percent] = part.split(" ");
    return {
      value: Number(value),
      at:
        percent === undefined
          ? index === 0
            ? 0
            : 1
          : Number(percent.replace("%", "")) / 100,
    };
  });
  const after = points.findIndex((point) => point.at >= at);
  const end = points[after];
  const start = points[Math.max(0, after - 1)];
  if (end.at === start.at) return end.value;
  const share = (at - start.at) / (end.at - start.at);
  return start.value + share * (end.value - start.value);
}

const omega = (2 * Math.PI) / spring.response;
/** A share of the spring's duration, from seconds. */
const share = (seconds: number) => (seconds * 1000) / spring.duration;

describe("springEasing", () => {
  // The design system's tokens.css keeps a copy, which the Inspector's
  // stylesheet ships minified.
  it("is the spring the panel's stylesheet carries", () => {
    const numbers = (value = "") => value.match(/-?\d*\.?\d+/g)?.map(Number);
    const token = /--ease-spring:\s*(linear\([^)]*\))/.exec(css)?.[1];
    const [, amount, unit] =
      /--duration-spring:\s*([\d.]+)(m?s)/.exec(css) ?? [];

    expect(numbers(token)).toEqual(numbers(springEasing()));
    expect(Number(amount) * (unit === "s" ? 1000 : 1)).toBe(spring.duration);
  });

  // A critically damped spring from rest is 1 - 2/e of the way there after
  // 1/ω seconds, and 1 - 3/e² after 2/ω.
  it("follows the spring from rest, without overshoot", () => {
    const easing = springEasing();

    expect(progressAt(easing, share(1 / omega))).toBeCloseTo(1 - 2 / Math.E, 2);
    expect(progressAt(easing, share(2 / omega))).toBeCloseTo(
      1 - 3 / Math.E ** 2,
      2
    );
    expect(progressAt(easing, 1)).toBe(1);
    const values = easing.match(/-?[\d.]+(?= |,|\))/g)!.map(Number);
    expect(
      values.every((value, index) => index === 0 || value >= values[index - 1])
    ).toBe(true);
    expect(Math.max(...values)).toBe(1);
  });

  // Starting at ω, it's 1 - 1/e of the way there after 1/ω.
  it("starts with the velocity it's handed", () => {
    expect(progressAt(springEasing(omega), share(1 / omega))).toBeCloseTo(
      1 - 1 / Math.E,
      2
    );
  });

  it("first carries on past its start when handed a velocity away", () => {
    expect(progressAt(springEasing(-10), share(0.02))).toBeLessThan(-0.05);
    expect(progressAt(springEasing(-10), 1)).toBe(1);
  });
});

describe("releaseVelocity", () => {
  // Every 10 ms, 4 px right and 2 px up: 400 px/s and -200 px/s.
  const steady = Array.from({ length: 20 }, (_, index) => ({
    x: index * 4,
    y: -index * 2,
    time: index * 10,
  }));

  it("is the drag's speed over its last 100 ms", () => {
    const velocity = releaseVelocity(steady, 190);

    expect(velocity.x).toBeCloseTo(400);
    expect(velocity.y).toBeCloseTo(-200);
  });

  it("hands on less from a drag that slowed before letting go", () => {
    expect(releaseVelocity(steady, 240).x).toBeCloseTo(200);
  });

  it("is none for a drag held still before letting go", () => {
    expect(releaseVelocity(steady, 400)).toEqual({ x: 0, y: 0 });
  });

  it("is none from a single moment", () => {
    expect(releaseVelocity([{ x: 10, y: 10, time: 0 }], 0)).toEqual({
      x: 0,
      y: 0,
    });
  });
});
