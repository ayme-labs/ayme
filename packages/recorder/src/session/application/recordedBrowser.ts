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
     * Carries out one request. It completes once the browser has done it, or
     * could not: a page that is gone answers nothing. Only a wait for a
     * Settled Page completes at once and goes on beside the queue.
     */
    readonly ask: (request: BrowserRequest) => Effect.Effect<void>;
  }
>()("@ayme-dev/recorder/session/RecordedBrowser") {}
