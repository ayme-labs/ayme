import type {
  RecorderCommandType,
  RecorderState,
  RecorderUpdate,
} from "@ayme-dev/recorder/contract";
import { useCallback, useEffect, useState } from "react";

import type { RecorderChannel } from "../application/recorderChannel";
import { newest } from "../domain/newest";

/** The recorder as the window shows it: the newest state heard, or null
 * before the first, and a way to ask it something. */
export function useRecorder(channel: RecorderChannel): {
  state: RecorderState | null;
  send(type: RecorderCommandType): void;
} {
  const [update, setUpdate] = useState<RecorderUpdate | null>(null);
  useEffect(
    () =>
      channel.subscribe((heard) => setUpdate((shown) => newest(shown, heard))),
    [channel]
  );
  // The answer needs nothing done: the state that follows shows it.
  const send = useCallback(
    (type: RecorderCommandType) => void channel.send({ type }).catch(() => {}),
    [channel]
  );
  return { state: update?.state ?? null, send };
}
