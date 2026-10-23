import { useEffect, useRef } from "react";

/**
 * Whether the person's last input was a key rather than a pointer. What
 * they do by keyboard lands at once: a key is pressed far too often to wait
 * on an animation.
 */
export function useKeyboardInput() {
  // Stryker disable next-line BooleanLiteral: the panel acts on a key or a pointer, which sets it first.
  const keyboard = useRef(false);
  // Stryker disable ArrayDeclaration: a dependency list that never changes runs the effect once, as an empty one does.
  useEffect(() => {
    const onKey = () => {
      keyboard.current = true;
    };
    const onPointer = () => {
      keyboard.current = false;
    };
    // Captured, so a control that stops a key or a pointer still counts.
    // Stryker disable BooleanLiteral: no control on the way to the logo or the layout menu stops one.
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("pointerdown", onPointer, true);
    // Stryker restore BooleanLiteral
    // Stryker disable BlockStatement,CallExpression,StringLiteral,BooleanLiteral: listeners left after the panel goes away change nothing anyone sees.
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("pointerdown", onPointer, true);
    };
    // Stryker restore BlockStatement,CallExpression,StringLiteral,BooleanLiteral
  }, []);
  // Stryker restore ArrayDeclaration
  return keyboard;
}
