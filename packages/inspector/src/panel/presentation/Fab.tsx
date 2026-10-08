import { useRef, type Ref } from "react";

import { AymeMark, usePointerDrag } from "../../shared";
import { fitLogo, type Viewport } from "../domain/geometry";
import type { Point } from "../domain/preferences";

/**
 * The collapsed Inspector: the ayme logo, draggable anywhere in the viewport.
 * It keeps the brand fill in both themes, so it reads the same on any page.
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
      className="pointer-events-auto absolute flex size-12 cursor-grab touch-none items-center justify-center rounded-full bg-primary p-2.5 shadow-lg inset-ring inset-ring-white/15 shadow-primary/40 transition-transform duration-(--duration-fast) ease-(--ease-out) active:scale-[0.97] active:cursor-grabbing"
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
      <AymeMark className="size-full fill-primary-foreground" />
    </button>
  );
}
