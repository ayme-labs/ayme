import type { RunFocus } from "../domain/run";
import { RunsView, type RunsViewProps } from "../view/RunsView";
import { useRunsTimeline } from "./useRunsTimeline";

export type RunsProps = Omit<
  RunsViewProps,
  keyof ReturnType<typeof useRunsTimeline>
> & {
  /** Brings a run into view. */
  focus?: RunFocus;
  /** Called once the focused run is in view, so the focus can be let go. */
  onFocusShown?: () => void;
};

/** Runs: the timeline of the runs made from the panel, newest first. */
export function Runs({ focus, onFocusShown, ...props }: RunsProps) {
  return <RunsView {...props} {...useRunsTimeline(focus, onFocusShown)} />;
}
