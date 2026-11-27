// A hosted Tab's Inspector contract, as the project's Node Host serves it.
import { Effect, Queue, Stream } from "effect";

import type { TabInspector } from "../../../session/application";
import { TabReadError } from "../../../session/domain";
import type { InspectorPort } from "../inspectorPort";

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
