import type { RecorderState } from "@ayme-dev/recorder/contract";

/** What the timeline shows of the recorder's state: no Visit, and no
 * command that applies, before the state is known. */
export function timelineOf(state: RecorderState | null) {
  return state
    ? { visits: state.visits, commands: state.commands }
    : { visits: [], commands: [] };
}
