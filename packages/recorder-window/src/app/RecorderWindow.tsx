import { useEffect } from "react";

import { useRecorder, type RecorderChannel } from "../channel";
import { ControlsView, useTheme } from "../controls";
import { TimelineView, timelineOf, windowTitle } from "../timeline";

/** The recorder window: the controls above, the recording below, both the
 * newest state the channel has told. It is dark as the person chose or as
 * the system is, followed live, and its title names the page that is open. */
export function RecorderWindow({ channel }: { channel: RecorderChannel }) {
  const { state, send, ask } = useRecorder(channel);
  const { visits, commands } = timelineOf(state);
  const { preference, choose, dark } = useTheme();
  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
  }, [dark]);
  const title = windowTitle(state?.url ?? null);
  useEffect(() => {
    const before = document.title;
    document.title = title;
    return () => {
      document.title = before;
    };
  }, [title]);
  return (
    <div className="flex min-h-dvh flex-col bg-linear-to-br from-background to-muted/40">
      <ControlsView
        state={state}
        onCommand={send}
        theme={{ preference, onChange: choose }}
      />
      <TimelineView visits={visits} commands={commands} onCommand={ask} />
    </div>
  );
}
