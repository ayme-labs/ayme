import { useRecorder, type RecorderChannel } from "../channel";
import { ToolbarView } from "../controls";

/** The toolbar in a recorded page: the controls, showing the newest state
 * the channel has told. */
export function RecorderToolbar({ channel }: { channel: RecorderChannel }) {
  const { state, send } = useRecorder(channel);
  return <ToolbarView state={state} onCommand={send} />;
}
