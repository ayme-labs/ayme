import { useEffect, useRef, type PointerEvent } from "react";

/** A press moves this far before it counts as a drag rather than a click. */
const DRAG_THRESHOLD = 4;

export type DragHandlers = {
  /** Called for each move once the press became a drag. */
  onMove: (
    deltaX: number,
    deltaY: number,
    pointer: { x: number; y: number }
  ) => void;
  onEnd?: (moved: boolean) => void;
};

/**
 * Pointer drags that follow the pointer on the window from the press on a
 * handle, so a drag keeps going when the pointer leaves the handle. Once the
 * press becomes a drag, the handle captures the pointer, so the cursor and
 * hover stay the handle's over the page. Only the pointer that pressed
 * drives it. One drag runs at a time: a new press ends the one before, so a
 * drag whose release never came can't hold on, and unmounting ends it too.
 */
export function usePointerDrag() {
  const endCurrent = useRef<() => void>(undefined);
  useEffect(() => () => endCurrent.current?.(), []);

  return (event: PointerEvent, { onMove, onEnd }: DragHandlers) => {
    if (event.button !== 0) return;
    endCurrent.current?.();
    const handle = event.currentTarget;
    const { pointerId } = event;
    const startX = event.clientX;
    const startY = event.clientY;
    let moved = false;

    const move = (moveEvent: globalThis.PointerEvent) => {
      if (moveEvent.pointerId !== pointerId) return;
      const deltaX = moveEvent.clientX - startX;
      const deltaY = moveEvent.clientY - startY;
      if (!moved && Math.abs(deltaX) + Math.abs(deltaY) < DRAG_THRESHOLD)
        return;
      // Stryker disable next-line ConditionalExpression,BooleanLiteral,CallExpression: a dispatched pointer can't be captured, so no component test sees it.
      if (!moved) capture(handle, pointerId);
      moved = true;
      moveEvent.preventDefault();
      onMove(deltaX, deltaY, { x: moveEvent.clientX, y: moveEvent.clientY });
    };
    const end = (endEvent?: globalThis.PointerEvent) => {
      if (endEvent && endEvent.pointerId !== pointerId) return;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
      endCurrent.current = undefined;
      onEnd?.(moved);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
    endCurrent.current = end;
  };
}

// Stryker disable next-line BlockStatement: a dispatched pointer can't be captured, so no component test sees it.
function capture(handle: Element, pointerId: number) {
  // Stryker disable next-line BlockStatement: a dispatched pointer can't be captured, so no component test sees it.
  try {
    // Stryker disable next-line CallExpression: as above.
    handle.setPointerCapture(pointerId);
  } catch {
    // A pointer the browser doesn't have, like a dispatched one, can't be
    // captured; the drag follows it on the window all the same.
  }
}
