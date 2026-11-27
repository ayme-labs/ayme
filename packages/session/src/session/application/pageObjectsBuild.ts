import { Context, type Effect, type Scope, type Stream } from "effect";

import type { SessionStartError } from "../domain";

/**
 * The project's Page Objects, built for Node. The Session reads nothing of
 * them: it hands them to the Tab it is the Host of, and what they hold is
 * the business of the adapter that built them and the one that runs them.
 */
export type BuiltPageObjects = unknown;

/**
 * Builds the Page Objects of the project's ayme folder for Node: the
 * Session's second seam, beside its browser. A build reads no page, so it
 * runs while the browser opens. It fails with the build's errors, as
 * `ayme open` prints them. Each run of `build` builds again, from the
 * source as it is then; `edits` tells when that source changed.
 */
export class PageObjectsBuild extends Context.Service<
  PageObjectsBuild,
  {
    readonly build: Effect.Effect<
      BuiltPageObjects,
      SessionStartError,
      Scope.Scope
    >;
    /** Each edit to the source the last finished build read, from when
     * the stream runs. */
    readonly edits: Stream.Stream<void>;
    /** Why the source cannot be watched, while it cannot: an edit there
     * may go untold. */
    readonly unwatched: () => string | undefined;
  }
>()("@ayme-dev/session/session/PageObjectsBuild") {}
