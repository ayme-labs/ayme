import type { RunFocus } from "../domain/run";
import { RunsView, type RunsViewProps } from "../view/RunsView";
import { useRunsTimeline } from "./useRunsTimeline";

export type RunsProps = Omit<
  RunsViewProps,
  keyof ReturnType<typeof useRunsTimeline>
> & {
  /** Brings a run into view. */
  focus?: RunFocus;
};

/** Runs: the timeline of the runs made from the panel, newest first. */
export function Runs({ focus, ...props }: RunsProps) {
  return <RunsView {...props} {...useRunsTimeline(focus)} />;
}
