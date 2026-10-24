import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";

import { spring, springEasing, springVelocity } from "../domain/motion";
import type { Point } from "../domain/preferences";

const reducedMotion = "(prefers-reduced-motion: reduce)";

/**
 * One axis of a glide: how far it started from where it's going, and how
 * fast it set off, as a share of that distance per second.
 */
type Glide = {
  axis: "x" | "y";
  offset: number;
  velocity: number;
  animation: Animation;
};

/**
 * Glides the panel from where it was to where a layout change put it, on the
 * spring. It moves by `translate` alone: the new size shows from the first
 * frame, so text never stretches. X and Y each spring on their own, so a
 * panel thrown sideways doesn't drop down at the same pace.
 *
 * `from` takes where the panel is just before the change, and the velocity a
 * drag let go of it at. A glide under way stops there, so the next one
 * starts from where the panel shows, and at the speed it was going.
 * `hold` keeps a glide where it shows until `resume` lets it go on. With
 * reduced motion, or without matchMedia (jsdom), the panel moves at once.
 */
export function useGlide(panel: RefObject<HTMLElement | null>) {
  const start = useRef<{ box: DOMRect; velocity: Point }>(undefined);
  const glides = useRef<Glide[]>([]);

  const gliding = () =>
    // Stryker disable next-line ConditionalExpression,MethodExpression: a glide that has finished, or none, leaves the panel where it floats, so taking hold of it where it shows is the same; and both axes start and end together.
    glides.current.some(({ animation }) => animation.playState === "running");
  const stop = () => {
    for (const { animation } of glides.current) animation.cancel();
    glides.current = [];
  };
  // How fast the panel glides now, in px/s, from the spring each axis is on.
  // A glide that has finished is all but still.
  const currentVelocity = (): Point => {
    const now = { x: 0, y: 0 };
    for (const { axis, offset, velocity, animation } of glides.current)
      now[axis] =
        -offset *
        springVelocity(velocity, Number(animation.currentTime) / 1000);
    return now;
  };
  const from = (released?: Point) => {
    const element = panel.current;
    if (
      !element ||
      typeof window.matchMedia !== "function" ||
      window.matchMedia(reducedMotion).matches
    )
      return;
    start.current = {
      box: element.getBoundingClientRect(),
      velocity: released ?? currentVelocity(),
    };
    stop();
  };
  // A rate of 0 holds a glide where it is; a paused one would start over
  // from its beginning if it were played again once past its end.
  const hold = () => {
    for (const { animation } of glides.current) animation.playbackRate = 0;
  };
  const resume = () => {
    for (const { animation } of glides.current) animation.playbackRate = 1;
  };

  useLayoutEffect(() => {
    const element = panel.current;
    const next = start.current;
    start.current = undefined;
    if (!element || !next) return;
    const { box, velocity } = next;
    const to = element.getBoundingClientRect();
    glides.current = (["x", "y"] as const).flatMap((axis) => {
      const offset = box[axis] - to[axis];
      // Stryker disable next-line EqualityOperator: a glide of exactly half a pixel shows the same as none.
      if (Math.abs(offset) < 0.5) return [];
      // The velocity as a share of the way to go: toward it is positive.
      const share = -velocity[axis] / offset;
      const animation = element.animate(
        {
          translate: [
            axis === "x" ? `${offset}px 0` : `0 ${offset}px`,
            // Stryker disable next-line StringLiteral: an end the browser can't read ends where the panel is laid out, as `0 0` does.
            "0 0",
          ],
        },
        {
          duration: spring.duration,
          easing: springEasing(share),
          composite: "add",
        }
      );
      return [{ axis, offset, velocity: share, animation }];
    });
  });
  // Stryker disable next-line ArrowFunction,ArrayDeclaration,CallExpression: the panel goes with the shell, so a glide left on it shows nowhere; and a dependency list that never changes runs the effect once, as an empty one does.
  useEffect(() => () => stop(), []);

  return { from, stop, gliding, hold, resume };
}
