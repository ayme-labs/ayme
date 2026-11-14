import { Context, type Effect, type Queue } from "effect";

import type { BrowserRequest, BrowserSignal } from "../domain/lifecycle";

/**
 * The recorded browser: the one seam of the engine. It speaks the engine's
 * words, never Playwright's. Building its layer opens the browser, and
 * closing the layer's scope lets the browser go.
 *
 * The engine asks, and the browser tells. Nothing comes back from `ask`:
 * what came of a request is told through `signals`, in one stream with what
 * the browser noticed by itself, so that the lifecycle sees all of it in the
 * order it happened.
 */
export class RecordedBrowser extends Context.Service<
  RecordedBrowser,
  {
    /** Everything the browser tells the engine, in the order it happened. */
    readonly signals: Queue.Dequeue<BrowserSignal>;
    /**
     * Takes one request and completes at once, whatever the request: the
     * browser carries it out in its own time, and the engine's one worker
     * never waits on it. A request the browser could not carry out, as on a
     * page that is gone, is answered by nothing.
     */
    readonly ask: (request: BrowserRequest) => Effect.Effect<void>;
  }
>()("@ayme-dev/recorder/session/RecordedBrowser") {}
