// A hosted Tab's Inspector contract, as the project's Node Host serves it.
import { Effect, Queue, Stream } from "effect";

import type { TabInspector } from "../../../session/application";
import { TabReadError } from "../../../session/domain";

/** What the Session uses of the Inspector contract the project's
 * `@ayme-dev/ayme/internal` serves for a Node Host. */
export type InspectorPort = {
  request(method: string, params: unknown): Promise<unknown>;
  subscribe(listener: (event: unknown) => void): () => void;
};

/** The Tab's Inspector contract over `port`. */
export const tabInspector = (port: InspectorPort): TabInspector => ({
  request: (method, params) =>
    Effect.tryPromise({
      try: () => port.request(method, params),
      catch: (cause) =>
        new TabReadError(
          cause instanceof Error ? cause.message : String(cause)
        ),
    }),
  events: Stream.callback<unknown>((queue) =>
    Effect.acquireRelease(
      Effect.sync(() =>
        port.subscribe((event) => void Queue.offerUnsafe(queue, event))
      ),
      (stop) => Effect.sync(stop)
    )
  ),
});
