import { useEffect, useRef, type PointerEvent } from "react";

import type { Point } from "./preferences";

/** A press moves this far before it counts as a drag rather than a click. */
const DRAG_THRESHOLD = 4;

export type DragHandlers = {
  /** Called for each move once the press became a drag. */
  onMove: (deltaX: number, deltaY: number, pointer: Point) => void;
  onEnd?: (moved: boolean) => void;
};

/**
 * Pointer drags that follow the pointer on the window from the press on a
 * handle, so a drag keeps going when the pointer leaves the handle. Only one
 * drag runs at a time; unmounting ends it.
 */
export function usePointerDrag() {
  const endCurrent = useRef<() => void>(undefined);
  useEffect(() => () => endCurrent.current?.(), []);

  return (event: PointerEvent, { onMove, onEnd }: DragHandlers) => {
    if (event.button !== 0) return;
    endCurrent.current?.();
    const startX = event.clientX;
    const startY = event.clientY;
    let moved = false;

    const move = (moveEvent: globalThis.PointerEvent) => {
      const deltaX = moveEvent.clientX - startX;
      const deltaY = moveEvent.clientY - startY;
      if (!moved && Math.abs(deltaX) + Math.abs(deltaY) < DRAG_THRESHOLD)
        return;
      moved = true;
      moveEvent.preventDefault();
      onMove(deltaX, deltaY, { x: moveEvent.clientX, y: moveEvent.clientY });
    };
    const end = () => {
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
