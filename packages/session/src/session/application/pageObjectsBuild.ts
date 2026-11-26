import { Context, type Effect, type Scope } from "effect";

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
 * `ayme open` prints them.
 */
export class PageObjectsBuild extends Context.Service<
  PageObjectsBuild,
  {
    readonly build: Effect.Effect<
      BuiltPageObjects,
      SessionStartError,
      Scope.Scope
    >;
  }
>()("@ayme-dev/session/session/PageObjectsBuild") {}
