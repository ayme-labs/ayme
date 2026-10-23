import { useLayoutEffect, useRef } from "react";

import type { Layout } from "../domain/preferences";

/**
 * Slides the panel to a layout chosen from the menu, from where it is on
 * screen to its new place. Only `translate` moves: the panel takes its new
 * size at once, so its text never stretches. A choice made mid-slide turns
 * the panel from where it is. A reload or a drop after a drag doesn't slide,
 * and reduced motion places the panel at once.
 *
 * Returns the ref for the panel, the call to make before choosing a layout
 * that should slide, and the call that stops a slide under way, which gives
 * how far from its place the panel showed.
 */
export function usePanelSlide(layout: Layout) {
  const panel = useRef<HTMLElement>(null);
  const from = useRef<DOMRect>(undefined);
  const slide = useRef<Animation>(undefined);

  useLayoutEffect(() => {
    slide.current?.cancel();
    const start = from.current;
    from.current = undefined;
    const element = panel.current;
    if (!start || !element) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const end = element.getBoundingClientRect();
    // The motion tokens, which an animation's options can't reference.
    const style = getComputedStyle(element);
    slide.current = element.animate(
      {
        translate: [
          `${start.x - end.x}px ${start.y - end.y}px`,
          // Stryker disable next-line StringLiteral: an empty last frame ends at the panel's own translate, none, as "0 0" does.
          "0 0",
        ],
      },
      {
        duration: milliseconds(style.getPropertyValue("--duration-normal")),
        // Stryker disable next-line MethodExpression: Chrome hands the token back trimmed; another browser may keep its leading space.
        easing: style.getPropertyValue("--ease-in-out").trim(),
      }
    );
  }, [layout]);

  const willChoose = () => {
    from.current = panel.current!.getBoundingClientRect();
  };
  const stop = () => {
    const element = panel.current;
    // A drag can outlive the panel, collapsed by a key while it's held.
    if (!element) return { x: 0, y: 0 };
    const shown = element.getBoundingClientRect();
    slide.current?.cancel();
    const placed = element.getBoundingClientRect();
    return { x: shown.x - placed.x, y: shown.y - placed.y };
  };
  return [panel, willChoose, stop] as const;
}

/**
 * A CSS time in milliseconds. The built stylesheet writes "200ms" as ".2s".
 */
export function milliseconds(time: string) {
  const value = parseFloat(time);
  return time.trim().endsWith("ms") ? value : value * 1000;
}
