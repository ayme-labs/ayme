import type {
  CommandResult,
  RecorderCommand,
  RecorderUpdate,
} from "@ayme-dev/recorder/contract";

/** The window's channel to the recorder, as the window uses it. */
export type RecorderChannel = {
  send(command: RecorderCommand): Promise<CommandResult>;
  /** Calls the listener with the full state first, then with each change.
   * Returns "unsubscribe". */
  subscribe(listener: (update: RecorderUpdate) => void): () => void;
};
