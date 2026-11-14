import type {
  CommandResult,
  RecorderUpdate,
  ToolbarMessage,
} from "@ayme-dev/recorder/contract";

import type { RecorderChannel } from "../application/recorderChannel";
import { newest } from "../domain/newest";

/**
 * The in-page toolbar's channel to the recorder, through the one function
 * the engine puts in every recorded page (`call`). The toolbar pulls the
 * state: it asks for the first update above the newest it heard, and asks
 * again once that comes, until the recorder has ended. An update older than
 * one it heard is not passed on.
 */
export function openPageRecorderChannel(
  call: (message: ToolbarMessage) => Promise<unknown>
): RecorderChannel {
  return {
    send: (command) =>
      call({ kind: "send", command }) as Promise<CommandResult>,
    subscribe(listener) {
      let subscribed = true;
      void (async () => {
        let shown: RecorderUpdate | null = null;
        while (subscribed) {
          const heard = (await call({
            kind: "update",
            after: shown?.revision ?? -1,
          }).catch(() => null)) as RecorderUpdate | null;
          // The recorder has ended, or the page is going away.
          if (!heard || !subscribed) return;
          const next = newest(shown, heard);
          if (next === shown) continue;
          shown = next;
          listener(next);
        }
      })();
      return () => {
        subscribed = false;
      };
    },
  };
}
