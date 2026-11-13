import type {
  RecorderCommandType,
  RecorderState,
} from "@ayme-dev/recorder/contract";
import { Button } from "@ayme-dev/design-system/components/button";
import { Circle, ListX, Play, Square } from "lucide-react";

import { statusText } from "../domain/status";

/** The one control that records, stops or continues, by the phase. */
function primaryOf(state: RecorderState) {
  switch (state.phase) {
    case "notRecording":
      return { type: "record", label: "Record", Icon: Circle } as const;
    case "paused":
      return { type: "continue", label: "Continue", Icon: Play } as const;
    case "ended":
      return null;
    default:
      return { type: "stop", label: "Stop", Icon: Square } as const;
  }
}

/**
 * The window's controls. Which can be pressed now comes from the engine
 * (`commands`): the window repeats none of its rules. While the recorder
 * wraps up, nothing can be pressed.
 */
export function ControlsView({
  state,
  onCommand,
}: {
  state: RecorderState | null;
  onCommand(type: RecorderCommandType): void;
}) {
  const applies = (type: RecorderCommandType) =>
    state?.commands.includes(type) ?? false;
  const primary = state && primaryOf(state);
  return (
    <header
      role="toolbar"
      aria-label="Recorder controls"
      className="sticky top-0 z-10 flex items-center gap-3 border-b bg-background/95 px-4 py-3 backdrop-blur"
    >
      {primary && (
        <Button
          variant="secondary"
          disabled={!applies(primary.type)}
          onClick={() => onCommand(primary.type)}
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
        className="min-w-0 flex-1 truncate text-sm text-muted-foreground"
      >
        {statusText(state)}
      </p>
      {state && (
        <>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Clear"
            title="Clear"
            disabled={!applies("clear")}
            onClick={() => onCommand("clear")}
          >
            <ListX />
          </Button>
          <Button
            disabled={!applies("finish")}
            onClick={() => onCommand("finish")}
          >
            Finish
          </Button>
        </>
      )}
    </header>
  );
}
