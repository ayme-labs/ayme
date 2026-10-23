import { useLayoutEffect, useRef } from "react";

import type { Layout } from "../domain/preferences";

/**
 * Slides the panel to a layout chosen from the menu, from where it is on
 * screen to its new place. Only `translate` moves: the panel takes its new
 * size at once, so its text never stretches. A choice made mid-slide turns
 * the panel from where it is. A reload or a drop after a drag doesn't slide,
 * and reduced motion places the panel at once.
 *
 * Returns the ref for the panel and the call to make before choosing a layout.
 */
export function usePanelSlide(layout: Layout) {
  const panel = useRef<HTMLElement>(null);
  const from = useRef<DOMRect>(undefined);
  const slide = useRef<Animation>(undefined);

  useLayoutEffect(() => {
    const start = from.current;
    from.current = undefined;
    const element = panel.current;
    if (!start || !element) return;
    slide.current?.cancel();
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const end = element.getBoundingClientRect();
    // The motion tokens, which an animation's options can't reference.
    const style = getComputedStyle(element);
    slide.current = element.animate(
      { translate: [`${start.x - end.x}px ${start.y - end.y}px`, "0 0"] },
      {
        duration: milliseconds(style.getPropertyValue("--duration-normal")),
        easing: style.getPropertyValue("--ease-in-out").trim(),
      }
    );
  }, [layout]);

  const willChoose = () => {
    from.current = panel.current?.getBoundingClientRect();
  };
  return [panel, willChoose] as const;
}

/**
 * A CSS time in milliseconds. The built stylesheet writes "200ms" as ".2s".
 */
function milliseconds(time: string) {
  const value = parseFloat(time);
  return time.trim().endsWith("ms") ? value : value * 1000;
}
