import type {
  CommandResult,
  RecorderCommand,
  RecorderState,
  RecorderUpdate,
} from "@ayme-dev/recorder/contract";
import { useCallback, useEffect, useState } from "react";

import type { RecorderChannel } from "../application/recorderChannel";
import { newest } from "../domain/newest";

/** The recorder as the window shows it: the newest state heard, or null
 * before the first, and a way to ask it something: `send` when the state
 * that follows shows the answer, `ask` when the answer itself is needed,
 * null when the recorder could not be asked. */
export function useRecorder(channel: RecorderChannel): {
  state: RecorderState | null;
  send(command: RecorderCommand): void;
  ask(command: RecorderCommand): Promise<CommandResult | null>;
} {
  const [update, setUpdate] = useState<RecorderUpdate | null>(null);
  useEffect(
    () =>
      channel.subscribe((heard) => setUpdate((shown) => newest(shown, heard))),
    // Stryker disable next-line ArrayDeclaration: a window or a toolbar keeps its one channel while it is mounted
    [channel]
  );
  // The answer needs nothing done: the state that follows shows it.
  const send = useCallback(
    (command: RecorderCommand) => void channel.send(command).catch(() => {}),
    // Stryker disable next-line ArrayDeclaration: a window or a toolbar keeps its one channel while it is mounted
    [channel]
  );
  const ask = useCallback(
    (command: RecorderCommand) => channel.send(command).catch(() => null),
    // Stryker disable next-line ArrayDeclaration: a window or a toolbar keeps its one channel while it is mounted
    [channel]
  );
  return { state: update?.state ?? null, send, ask };
}
