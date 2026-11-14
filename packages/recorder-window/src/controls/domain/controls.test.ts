import type {
  RecorderCommandType,
  RecorderState,
} from "@ayme-dev/recorder/contract";
import { describe, expect, it } from "vitest";

import { controlsOf } from "./controls";

// The window's and the toolbar's controls, read from the recorder's state:
// which are shown, what each asks, and which can be pressed now.

const state = (
  phase: Partial<RecorderState> & Pick<RecorderState, "phase">,
  commands: RecorderCommandType[]
) => ({ visits: [], warnings: [], ...phase, commands }) as RecorderState;

describe("the controls", () => {
  it("show only the status before the recorder's state is known", () => {
    expect(controlsOf(null)).toEqual({
      status: "Connecting…",
      primary: null,
      assert: null,
      clear: null,
      finish: null,
    });
  });

  it("offer Record when not recording, and nothing else that cannot apply", () => {
    expect(controlsOf(state({ phase: "notRecording" }, ["record"]))).toEqual({
      status: "Not recording",
      primary: {
        command: { type: "record" },
        label: "Record",
        enabled: true,
      },
      assert: {
        command: { type: "assertVisibility" },
        label: "Assert visibility",
        enabled: false,
        pressed: false,
      },
      clear: { command: { type: "clear" }, label: "Clear", enabled: false },
      finish: { command: { type: "finish" }, label: "Finish", enabled: false },
    });
  });

  it("offer Stop, Assert visibility, Clear and Finish while recording", () => {
    expect(
      controlsOf(
        state({ phase: "recording" }, [
          "finish",
          "stop",
          "clear",
          "assertVisibility",
        ])
      )
    ).toEqual({
      status: "Recording",
      primary: { command: { type: "stop" }, label: "Stop", enabled: true },
      assert: {
        command: { type: "assertVisibility" },
        label: "Assert visibility",
        enabled: true,
        pressed: false,
      },
      clear: { command: { type: "clear" }, label: "Clear", enabled: true },
      finish: { command: { type: "finish" }, label: "Finish", enabled: true },
    });
  });

  it("show Assert visibility pressed while Playwright picks, and leave it when pressed", () => {
    expect(
      controlsOf(
        state({ phase: "recording", picking: true }, [
          "finish",
          "stop",
          "clear",
          "leaveAssertVisibility",
        ])
      ).assert
    ).toEqual({
      command: { type: "leaveAssertVisibility" },
      label: "Assert visibility",
      enabled: true,
      pressed: true,
    });
  });

  it("offer Continue when paused", () => {
    expect(
      controlsOf(state({ phase: "paused" }, ["finish", "continue", "clear"]))
        .primary
    ).toEqual({
      command: { type: "continue" },
      label: "Continue",
      enabled: true,
    });
  });

  it("keep Stop shown but not pressable while the recorder wraps up", () => {
    expect(
      controlsOf(state({ phase: "wrappingUp", then: "pause" }, [])).primary
    ).toEqual({ command: { type: "stop" }, label: "Stop", enabled: false });
  });

  it("show no Record, Stop or Continue once the recorder has ended", () => {
    const ended = controlsOf(
      state({ phase: "ended", outcome: { kind: "empty" } }, [])
    );

    expect(ended.primary).toBeNull();
    expect([
      ended.assert?.enabled,
      ended.clear?.enabled,
      ended.finish?.enabled,
    ]).toEqual([false, false, false]);
  });
});
