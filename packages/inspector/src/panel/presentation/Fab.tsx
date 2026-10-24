import { useRef, type Ref } from "react";

import { cn } from "@ayme-dev/design-system/lib/utils";

import { AymeMark, usePointerDrag } from "../../shared";
import { fitLogo, type Viewport } from "../domain/geometry";
import type { Point } from "../domain/preferences";
import type { Presence } from "./usePresence";

/**
 * The collapsed Inspector: the ayme logo, draggable anywhere in the viewport.
 * It keeps the brand fill in both themes, so it reads the same on any page.
 * A click that ends a drag does not open the panel. It enters and leaves
 * with the panel, from a frame of its own, so its press keeps its own
 * timing.
 */
export function Fab({
  position,
  viewport,
  onMove,
  onOpen,
  presence,
  ref,
}: {
  position: Point;
  viewport: Viewport;
  onMove: (position: Point) => void;
  onOpen: () => void;
  presence: Presence<HTMLDivElement>;
  ref?: Ref<HTMLButtonElement>;
}) {
  const drag = usePointerDrag();
  const dragged = useRef(false);

  return (
    <div
      ref={presence.ref}
      data-presence
      data-state={presence.state}
      inert={presence.state === "closed"}
      aria-hidden={presence.state === "closed" || undefined}
      className={cn("absolute size-12", presence.className)}
      style={{ left: position.x, top: position.y }}
    >
      <button
        ref={ref}
        type="button"
        aria-label="Open ayme"
        title="Drag to move. Click to open."
        aria-expanded={false}
        className="pointer-events-auto flex size-full cursor-grab touch-none items-center justify-center rounded-full bg-primary p-2.5 shadow-lg inset-ring inset-ring-white/15 shadow-primary/40 transition-transform duration-(--duration-fast) ease-(--ease-out) outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background active:cursor-grabbing motion-safe:active:scale-[0.97]"
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
    </div>
  );
}
