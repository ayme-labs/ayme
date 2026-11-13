import type {
  RecorderCommandType,
  RecorderState,
} from "@ayme-dev/recorder/contract";
import { Button } from "@ayme-dev/design-system/components/button";
import { ListX } from "lucide-react";

import { statusText } from "../domain/status";
import { primaryOf } from "./ControlsView";

/**
 * The toolbar in a recorded page: the window's controls, small. Which can
 * be pressed comes from the engine (`commands`), as in the window. Its
 * buttons take no focus: the page keeps its own.
 */
export function ToolbarView({
  state,
  onCommand,
}: {
  state: RecorderState | null;
  onCommand(type: RecorderCommandType): void;
}) {
  const applies = (type: RecorderCommandType) =>
    state?.commands.includes(type) ?? false;
  const primary = state && primaryOf(state);
  const control = (type: RecorderCommandType, label: string) => ({
    "aria-label": label,
    title: label,
    tabIndex: -1,
    disabled: !applies(type),
    onClick: () => onCommand(type),
  });
  return (
    <div
      role="toolbar"
      aria-label="Recorder toolbar"
      className="pointer-events-auto flex items-center gap-1 rounded-lg border bg-background/95 p-1 text-foreground shadow-lg backdrop-blur"
    >
      {primary && (
        <Button
          variant="ghost"
          size="sm"
          {...control(primary.type, primary.label)}
        >
          <primary.Icon
            className={
              primary.type === "record"
                ? "fill-red-500 text-red-500"
                : "fill-current"
            }
          />
          {primary.label}
        </Button>
      )}
      <p
        role="status"
        className="max-w-56 truncate px-2 text-xs text-muted-foreground"
      >
        {statusText(state)}
      </p>
      {/* Assert visibility joins the controls here. */}
      {state && (
        <>
          <Button variant="ghost" size="icon" {...control("clear", "Clear")}>
            <ListX />
          </Button>
          <Button size="sm" {...control("finish", "Finish")}>
            Finish
          </Button>
        </>
      )}
    </div>
  );
}
