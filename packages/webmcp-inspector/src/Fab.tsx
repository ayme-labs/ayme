import {
  useEffect,
  useRef,
  useState,
  type PointerEvent,
  type Ref,
} from "react";

import { AymeMark } from "./AymeMark";

const FAB_SIZE = 48;
const FAB_MARGIN = 16;
const DRAG_THRESHOLD = 4;

type Position = { left: number; top: number };

type Drag = {
  pointerId: number;
  startX: number;
  startY: number;
  startLeft: number;
  startTop: number;
  dragging: boolean;
};

function clampPosition({ left, top }: Position): Position {
  const maxLeft = Math.max(
    FAB_MARGIN,
    window.innerWidth - FAB_SIZE - FAB_MARGIN
  );
  const maxTop = Math.max(
    FAB_MARGIN,
    window.innerHeight - FAB_SIZE - FAB_MARGIN
  );
  return {
    left: Math.min(Math.max(left, FAB_MARGIN), maxLeft),
    top: Math.min(Math.max(top, FAB_MARGIN), maxTop),
  };
}

/**
 * The collapsed Inspector: the Ayme mark, draggable anywhere in the viewport.
 * A click that ends a drag does not open the panel.
 */
export function Fab({
  onOpen,
  ref,
}: {
  onOpen: () => void;
  ref?: Ref<HTMLButtonElement>;
}) {
  const [position, setPosition] = useState<Position>();
  const drag = useRef<Drag>(undefined);
  const dragged = useRef(false);

  useEffect(() => {
    const clampToViewport = () =>
      setPosition((current) => current && clampPosition(current));
    window.addEventListener("resize", clampToViewport);
    return () => window.removeEventListener("resize", clampToViewport);
  }, []);

  const startDrag = (event: PointerEvent<HTMLButtonElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    dragged.current = false;
    setPosition({ left: rect.left, top: rect.top });
    drag.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startLeft: rect.left,
      startTop: rect.top,
      dragging: false,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const moveDrag = (event: PointerEvent<HTMLButtonElement>) => {
    const state = drag.current;
    if (!state || event.pointerId !== state.pointerId) return;
    const deltaX = event.clientX - state.startX;
    const deltaY = event.clientY - state.startY;
    if (!state.dragging && Math.hypot(deltaX, deltaY) < DRAG_THRESHOLD) return;

    state.dragging = true;
    dragged.current = true;
    event.preventDefault();
    setPosition(
      clampPosition({
        left: state.startLeft + deltaX,
        top: state.startTop + deltaY,
      })
    );
  };

  const endDrag = (event: PointerEvent<HTMLButtonElement>) => {
    const state = drag.current;
    if (!state || event.pointerId !== state.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
    drag.current = undefined;
  };

  const click = () => {
    if (dragged.current) {
      dragged.current = false;
      return;
    }
    onOpen();
  };

  return (
    <button
      ref={ref}
      type="button"
      aria-label="Open Ayme POM inspector"
      aria-expanded={false}
      className="pointer-events-auto absolute flex size-12 touch-none items-center justify-center rounded-full border border-primary bg-background p-2 shadow-md active:cursor-grabbing"
      style={
        position
          ? { left: position.left, top: position.top }
          : { right: FAB_MARGIN, bottom: FAB_MARGIN }
      }
      onPointerDown={startDrag}
      onPointerMove={moveDrag}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onClick={click}
    >
      <AymeMark className="size-full" />
    </button>
  );
}
