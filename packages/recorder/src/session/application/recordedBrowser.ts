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
     * never waits on it. A request that breaks while the browser carries it
     * out is answered by "requestFailed", with the request. One may go
     * unanswered only when its page is gone, as the page's closing was
     * told, or when it has no answer by design: letting inputs through,
     * clearing the highlight, and a picking mode Playwright is in already.
     */
    readonly ask: (request: BrowserRequest) => Effect.Effect<void>;
    /** The browser was given a file to save its storage state to
     * (`--save-storage`): the recorder asks for that save as it ends. */
    readonly savesStorage: boolean;
  }
>()("@ayme-dev/recorder/session/RecordedBrowser") {}
