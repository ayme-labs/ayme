import { useRef, type Ref } from "react";

import { AymeMark } from "../AymeMark";
import { fitLogo, type Viewport } from "./geometry";
import type { Point } from "./preferences";
import { usePointerDrag } from "./pointerDrag";

/**
 * The collapsed Inspector: the ayme logo, draggable anywhere in the viewport.
 * A click that ends a drag does not open the panel.
 */
export function Fab({
  position,
  viewport,
  onMove,
  onOpen,
  ref,
}: {
  position: Point;
  viewport: Viewport;
  onMove: (position: Point) => void;
  onOpen: () => void;
  ref?: Ref<HTMLButtonElement>;
}) {
  const drag = usePointerDrag();
  const dragged = useRef(false);

  return (
    <button
      ref={ref}
      type="button"
      aria-label="Open ayme"
      title="Drag to move. Click to open."
      aria-expanded={false}
      className="pointer-events-auto absolute flex size-12 cursor-grab touch-none items-center justify-center rounded-full border border-primary bg-background p-2.5 shadow-lg active:cursor-grabbing"
      style={{ left: position.x, top: position.y }}
      onPointerDown={(event) => {
        dragged.current = false;
        drag(event, {
          onMove: (deltaX, deltaY) => {
            dragged.current = true;
            onMove(
              fitLogo(
                { x: position.x + deltaX, y: position.y + deltaY },
                viewport
              )
            );
          },
        });
      }}
      onClick={() => {
        if (dragged.current) dragged.current = false;
        else onOpen();
      }}
    >
      <AymeMark className="size-full" />
    </button>
  );
}
