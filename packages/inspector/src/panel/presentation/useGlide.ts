import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";

import { spring, springEasing } from "../domain/motion";
import type { Point } from "../domain/preferences";

const reducedMotion = "(prefers-reduced-motion: reduce)";

/**
 * Glides the panel from where it was to where a layout change put it, on the
 * spring. It moves by `translate` alone: the new size shows from the first
 * frame, so text never stretches. X and Y each spring on their own, so a
 * panel thrown sideways doesn't drop down at the same pace.
 *
 * `from` takes where the panel is just before the change, and the velocity a
 * drag let go of it at; a glide under way stops there, so the next one
 * starts from where the panel shows. With reduced motion, or without
 * matchMedia (jsdom), the panel moves at once.
 */
export function useGlide(panel: RefObject<HTMLElement | null>) {
  const start = useRef<{ box: DOMRect; velocity: Point }>(undefined);
  const glides = useRef<Animation[]>([]);

  const gliding = () =>
    // Stryker disable next-line ConditionalExpression: a glide that has finished leaves the panel where it floats, so taking hold of it where it shows is the same.
    glides.current.some(({ playState }) => playState === "running");
  const stop = () => {
    for (const glide of glides.current) glide.cancel();
    glides.current = [];
  };
  const from = (velocity: Point = { x: 0, y: 0 }) => {
    const element = panel.current;
    if (
      !element ||
      typeof window.matchMedia !== "function" ||
      window.matchMedia(reducedMotion).matches
    )
      return;
    start.current = { box: element.getBoundingClientRect(), velocity };
    stop();
  };

  useLayoutEffect(() => {
    const element = panel.current;
    const { box, velocity } = start.current ?? {};
    start.current = undefined;
    // Stryker disable next-line LogicalOperator,ConditionalExpression: the start's box and velocity are set and cleared together, and the panel is there whenever one is set, so any one of them decides.
    if (!element || !box || !velocity) return;
    const to = element.getBoundingClientRect();
    glides.current = (["x", "y"] as const).flatMap((axis) => {
      const offset = box[axis] - to[axis];
      // Stryker disable next-line EqualityOperator: a glide of exactly half a pixel shows the same as none.
      if (Math.abs(offset) < 0.5) return [];
      return [
        element.animate(
          {
            translate: [
              axis === "x" ? `${offset}px 0` : `0 ${offset}px`,
              // Stryker disable next-line StringLiteral: an end the browser can't read ends where the panel is laid out, as `0 0` does.
              "0 0",
            ],
          },
          {
            duration: spring.duration,
            // The velocity as a share of the way to go: toward it is positive.
            easing: springEasing(-velocity[axis] / offset),
            composite: "add",
          }
        ),
      ];
    });
  });
  // Stryker disable next-line ArrowFunction,ArrayDeclaration,CallExpression: the panel goes with the shell, so a glide left on it shows nowhere; and a dependency list that never changes runs the effect once, as an empty one does.
  useEffect(() => () => stop(), []);

  return { from, stop, gliding };
}
