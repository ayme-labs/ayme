import { useRef, type KeyboardEvent } from "react";

import { cn } from "@ayme-dev/design-system/lib/utils";

import { usePointerDrag } from "./pointerDrag";

/**
 * A resize grip's look, for a handle whose `::after` is the grip: hidden
 * until hovered or focused, in the border's colour, and a stronger colour
 * while pressed.
 */
export const resizeGrip =
  // Stryker disable next-line StringLiteral: Tailwind classes are styling, which no test reads.
  "after:absolute after:border-border after:bg-border after:opacity-0 after:transition-[opacity,background-color,border-color,scale] after:duration-(--duration-fast) after:ease-(--ease-out) hover:after:opacity-100 focus-visible:after:opacity-100 active:after:border-muted-foreground active:after:bg-muted-foreground active:after:opacity-100";

/*
 * A divider is 8px across and centred on the 1px border between two
 * regions: on the region before it (its end edge) or after it (its start
 * edge). Its 3px pill is placed by offsets, which keep it on whole pixels
 * either side of the border.
 */
const shape = {
  vertical: {
    line: "w-2 cursor-ew-resize after:top-[calc(50%-20px)] after:left-[calc(50%-1.5px)] after:h-10 after:w-[3px] active:after:scale-y-125",
    // Stryker disable next-line StringLiteral: Tailwind classes are styling, which no test reads.
    before: "-mr-[3.5px] -ml-[4.5px]",
    after: "-mr-[4.5px] -ml-[3.5px]",
  },
  horizontal: {
    line: "h-2 cursor-ns-resize after:top-[calc(50%-1.5px)] after:left-[calc(50%-20px)] after:h-[3px] after:w-10 active:after:scale-x-125",
    // Stryker disable next-line StringLiteral: Tailwind classes are styling, which no test reads.
    before: "-mt-[4.5px] -mb-[3.5px]",
    after: "-mt-[3.5px] -mb-[4.5px]",
  },
};

/**
 * A divider between two regions of the panel, in a flex row (a vertical
 * divider) or column (a horizontal one). Drag it, use the arrow keys, or
 * double-click it to go back to the default size.
 */
export function Divider({
  orientation,
  border,
  label,
  value,
  min,
  max,
  step,
  grows = "forward",
  perPixel = () => 1,
  onChange,
  onReset,
  className,
}: {
  orientation: "vertical" | "horizontal";
  /** Which region draws the border the divider sits on. */
  border: "before" | "after";
  label: string;
  value: number;
  min: number;
  max: number;
  /** How far one arrow key press moves the value. */
  step: number;
  /** Whether dragging right or down makes the value grow or shrink. */
  grows?: "forward" | "backward";
  /** How much the value changes per pixel dragged, read as a drag starts. */
  perPixel?: () => number;
  onChange: (value: number) => void;
  onReset?: () => void;
  className?: string;
}) {
  const drag = usePointerDrag();
  const start = useRef(value);
  const sign = grows === "forward" ? 1 : -1;
  const clamp = (next: number) => Math.min(max, Math.max(min, next));
  const keys =
    orientation === "vertical"
      ? { ArrowLeft: -1, ArrowRight: 1 }
      : { ArrowUp: -1, ArrowDown: 1 };

  const onKeyDown = (event: KeyboardEvent) => {
    const direction = keys[event.key as keyof typeof keys];
    if (!direction) return;
    event.preventDefault();
    onChange(clamp(value + direction * sign * step));
  };

  return (
    <div
      role="separator"
      aria-orientation={orientation}
      aria-label={label}
      aria-valuemin={Math.round(min)}
      aria-valuemax={Math.round(max)}
      aria-valuenow={Math.round(value)}
      tabIndex={0}
      title="Drag to resize. Double-click to reset."
      className={cn(
        "relative z-10 flex-none touch-none outline-none",
        resizeGrip,
        "after:rounded-full",
        shape[orientation].line,
        shape[orientation][border],
        className
      )}
      onKeyDown={onKeyDown}
      onDoubleClick={onReset}
      onPointerDown={(event) => {
        // A press on a text selection would start the browser's own drag.
        event.preventDefault();
        start.current = value;
        const scale = perPixel();
        drag(event, {
          onMove: (deltaX, deltaY) =>
            onChange(
              clamp(
                start.current +
                  sign * scale * (orientation === "vertical" ? deltaX : deltaY)
              )
            ),
        });
      }}
    />
  );
}
