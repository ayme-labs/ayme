import { useRecorder, type RecorderChannel } from "../channel";
import { ControlsView } from "../controls";
import { TimelineView } from "../timeline";

/** The recorder window: the controls above, the recording below, both the
 * newest state the channel has told. */
export function RecorderWindow({ channel }: { channel: RecorderChannel }) {
  const { state, send } = useRecorder(channel);
  return (
    <div className="flex min-h-dvh flex-col">
      <ControlsView state={state} onCommand={send} />
      <TimelineView
        visits={state?.visits ?? []}
        commands={state?.commands ?? []}
        onCommand={send}
      />
    </div>
  );
}
