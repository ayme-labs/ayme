import { useRecorder, type RecorderChannel } from "../channel";
import { ToolbarView, useSystemDark } from "../controls";

/** The toolbar in a recorded page: the controls, showing the newest state
 * the channel has told, dark when the system's scheme is, followed live. */
export function RecorderToolbar({ channel }: { channel: RecorderChannel }) {
  const { state, send } = useRecorder(channel);
  const dark = useSystemDark();
  return (
    <div className={dark ? "dark" : undefined}>
      <ToolbarView state={state} onCommand={send} />
    </div>
  );
}
