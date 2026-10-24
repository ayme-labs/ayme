import { useLayoutEffect, useRef, useState } from "react";

import type { BodyMeasure } from "../domain/regions";

// Stryker disable next-line ObjectLiteral: the layout effect replaces it with the body's measured sizes before the first paint.
const unmeasured: BodyMeasure = {
  width: 0,
  height: 0,
  navigatorWidth: 0,
  runsWidth: 0,
  runsHeight: 0,
};

/**
 * The size layout gives an element. Unlike getBoundingClientRect's box, it
 * doesn't shrink while the panel grows in from a smaller scale, which no
 * resize would report the end of. Without layout (jsdom), it's 0.
 */
function laidOut(element: Element) {
  const { width, height } = getComputedStyle(element);
  return { width: parseFloat(width) || 0, height: parseFloat(height) || 0 };
}

/**
 * The body's size and its regions' sizes, kept current as any of them
 * resizes. The body's first child is the row holding the navigator first;
 * its last child is Runs.
 */
export function useBodyMeasure(watch: unknown) {
  const body = useRef<HTMLDivElement>(null);
  const [measure, setMeasure] = useState(unmeasured);

  useLayoutEffect(() => {
    const element = body.current;
    const navigator = element?.firstElementChild?.firstElementChild;
    const runs = element?.lastElementChild;
    if (!element || !navigator || !runs) return;
    const read = () => {
      const bodySize = laidOut(element);
      const runsSize = laidOut(runs);
      setMeasure({
        width: bodySize.width,
        height: bodySize.height,
        navigatorWidth: laidOut(navigator).width,
        runsWidth: runsSize.width,
        runsHeight: runsSize.height,
      });
    };
    read();
    // Without ResizeObserver (jsdom), the first measure stands.
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(read);
    for (const target of [element, navigator, runs]) observer.observe(target);
    return () => observer.disconnect();
  }, [watch]);

  return [body, measure] as const;
}
