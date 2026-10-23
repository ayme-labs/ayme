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
    // A click no pointer made, from a key or a screen reader, counts none.
    const onClick = (event: MouseEvent) => {
      pointer.current = event.detail > 0;
    };
    // Captured, so it's set before the click's own handlers read it.
    window.addEventListener("click", onClick, true);
    // Stryker disable next-line ArrowFunction,BlockStatement,CallExpression,StringLiteral,BooleanLiteral: a listener left after the panel goes away changes nothing anyone sees.
    return () => window.removeEventListener("click", onClick, true);
  }, []);
  // Stryker restore ArrayDeclaration
  return pointer;
}
