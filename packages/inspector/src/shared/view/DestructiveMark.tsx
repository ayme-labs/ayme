import { TriangleAlertIcon } from "lucide-react";

/**
 * The mark of a tool whose author marked it destructive: a call cannot be
 * undone. It only says so; Run still runs the tool.
 */
export function DestructiveMark() {
  return (
    <span
      data-destructive-mark
      className="inline-flex h-4.5 flex-none items-center gap-0.75 rounded-full bg-destructive/10 px-1.5 text-[10px] leading-none font-medium whitespace-nowrap text-destructive"
    >
      <TriangleAlertIcon className="size-2.5" aria-hidden />
      Destructive
    </span>
  );
}

/**
 * A destructive tool's icon in a list row, in place of the tool icon, so
 * the row keeps its width. Hovering it says "Destructive"; the row says so
 * to assistive technology itself, since its name is the tool's.
 */
export function DestructiveIcon() {
  return (
    <span data-destructive-icon title="Destructive" className="flex flex-none">
      <TriangleAlertIcon className="size-3.5 text-destructive" aria-hidden />
    </span>
  );
}
