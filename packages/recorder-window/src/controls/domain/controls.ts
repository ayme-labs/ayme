import type {
  RecorderCommand,
  RecorderCommandType,
  RecorderState,
} from "@ayme-dev/recorder/contract";

import { statusText } from "./status";

/** One control: what pressing it asks, what it is called, and whether it
 * can be pressed now. Which can comes from the engine (`commands`): the
 * window repeats none of its rules. */
export type Control<Type extends RecorderCommandType = RecorderCommandType> = {
  readonly command: { readonly type: Type } & RecorderCommand;
  readonly label: string;
  readonly enabled: boolean;
};

/** The controls of the window and of the toolbar, read from the state. */
export type Controls = {
  /** What the recorder is doing, in words. */
  readonly status: string;
  /** The one control that records, stops or continues, by the phase; none
   * once the recorder has ended, or before its state is known. */
  readonly primary: Control<"record" | "stop" | "continue"> | null;
  /** Assert visibility: pressed while Playwright picks, when it leaves
   * picking. The rest are none before the state is known. */
  readonly assert:
    | (Control<"assertVisibility" | "leaveAssertVisibility"> & {
        readonly pressed: boolean;
      })
    | null;
  readonly clear: Control<"clear"> | null;
  readonly finish: Control<"finish"> | null;
};

/** Reads the controls from the recorder's state, or from none yet. */
export function controlsOf(state: RecorderState | null): Controls {
  if (!state)
    return {
      status: statusText(null),
      primary: null,
      assert: null,
      clear: null,
      finish: null,
    };
  const applies = (type: RecorderCommandType) => state.commands.includes(type);
  const control = <Type extends RecorderCommandType>(
    type: Type,
    label: string
  ): Control<Type> => ({
    command: { type } as Control<Type>["command"],
    label,
    enabled: applies(type),
  });
  // Leaving applies while Playwright picks, entering while it does not.
  const leave = applies("leaveAssertVisibility");
  return {
    status: statusText(state),
    primary:
      state.phase === "notRecording"
        ? control("record", "Record")
        : state.phase === "paused"
          ? control("continue", "Continue")
          : state.phase === "ended"
            ? null
            : control("stop", "Stop"),
    assert: {
      ...control(
        leave ? "leaveAssertVisibility" : "assertVisibility",
        "Assert visibility"
      ),
      enabled: leave || applies("assertVisibility"),
      pressed: state.phase === "recording" && state.picking === true,
    },
    clear: control("clear", "Clear"),
    finish: control("finish", "Finish"),
  };
}
