import { useEffect, useRef } from "react";

/**
 * Whether the person's last click came from a pointer. One a key or a screen
 * reader made lands at once: a key is pressed far too often to wait on an
 * animation.
 */
export function usePointerClick() {
  // Stryker disable next-line BooleanLiteral: every read follows a click, which sets it first.
  const pointer = useRef(true);
  // Stryker disable ArrayDeclaration: a dependency list that never changes runs the effect once, as an empty one does.
  useEffect(() => {
    // A menu item a pointer was pressed on elsewhere and let go of on it
    // clicks itself from within that pointerup, and counts no clicks. A
    // pointerup is on its way until every handler has run or one stopped it.
    let release: PointerEvent | undefined;
    const onRelease = (event: PointerEvent) => {
      release = event;
    };
    const releasing = () =>
      release !== undefined && release.eventPhase !== Event.NONE;
    // A click no pointer made, from a key or a screen reader, counts none.
    const onClick = (event: MouseEvent) => {
      pointer.current = event.detail > 0 || releasing();
    };
    // Captured, so each is set before the page's own handlers run.
    window.addEventListener("pointerup", onRelease, true);
    window.addEventListener("click", onClick, true);
    // Stryker disable ArrowFunction,BlockStatement,CallExpression,StringLiteral,BooleanLiteral: listeners left after the panel goes away change nothing anyone sees.
    return () => {
      window.removeEventListener("pointerup", onRelease, true);
      window.removeEventListener("click", onClick, true);
    };
    // Stryker restore ArrowFunction,BlockStatement,CallExpression,StringLiteral,BooleanLiteral
  }, []);
  // Stryker restore ArrayDeclaration
  return pointer;
}
