import { Context, type Queue } from "effect";

import type { BrowserSignal } from "../domain/lifecycle";

/**
 * The recorded browser: the one seam of the engine. It speaks the engine's
 * words, never Playwright's. Building its layer opens the browser, and
 * closing the layer's scope lets the browser go.
 */
export class RecordedBrowser extends Context.Service<
  RecordedBrowser,
  {
    /** Everything the browser tells the engine, in the order it happened. */
    readonly signals: Queue.Dequeue<BrowserSignal>;
  }
>()("@ayme-dev/recorder/session/RecordedBrowser") {}
