// The Session's Page Objects across edits: it builds them again when their
// source changes, and swaps a good build in on each Tab between its Runs
// (rule 7).
import { Cause, Effect, Exit, Option, Queue, Scope, Stream } from "effect";

import {
  brokenStart,
  RunError,
  type SessionStartError,
  type TabReadError,
} from "../domain";
import type { BuiltPageObjects, PageObjectsBuild } from "./pageObjectsBuild";
import type { HostedTab } from "./sessionBrowser";

/** The Session's Page Objects as its builds leave them. */
export interface Rebuilds {
  /** Why the last finished build failed, while it is the last: a build
   * still under way changes nothing yet. */
  readonly failing: () => SessionStartError | undefined;
  /**
   * `hosted`, whose Host runs the Page Objects of the first build, swapped
   * to the Session's newest before each listing, Run and Inspector Run.
   * Its `swap` swaps them in at once, whatever it is handed, since a build
   * can be dropped while a Swap waits: put it inside the Tab's turn.
   */
  readonly swapping: (hosted: HostedTab) => HostedTab;
  /** Swaps on `hosted`, through its `swap`, at once and after each good
   * build, until the Tab is `closed`. */
  readonly follow: (
    hosted: HostedTab,
    closed: Effect.Effect<void>
  ) => Effect.Effect<void>;
}

/**
 * Builds the Session's Page Objects again after each edit `builds` tells
 * of, from the `first` build, in `scope`. The newest edit wins: a build
 * that finishes after a newer edit is dropped, and the next one starts.
 * A good build waits for its Swap until a Tab's turn, and is dropped if a
 * later edit fails to build; a failed build swaps nothing in.
 */
export const rebuilding = (
  first: BuiltPageObjects,
  builds: PageObjectsBuild["Service"],
  scope: Scope.Scope
): Effect.Effect<Rebuilds> =>
  Effect.gen(function* () {
    // The build the Tabs that swapped last run, and a good build no Tab has
    // swapped in yet.
    let inForce = first;
    let waiting: BuiltPageObjects | undefined;
    let failing: SessionStartError | undefined;
    const followers = new Set<Effect.Effect<void>>();
    // One waiting edit stands for every edit since the last build began.
    const edited = yield* Queue.sliding<void>(1);
    yield* builds.edits.pipe(
      Stream.runForEach(() => Queue.offer(edited, undefined)),
      Effect.forkIn(scope)
    );
    const rebuild = Effect.gen(function* () {
      yield* Queue.take(edited);
      const built = yield* Effect.exit(builds.build.pipe(Scope.provide(scope)));
      if ((yield* Queue.size(edited)) > 0) return;
      if (Exit.isSuccess(built)) {
        waiting = built.value;
        failing = undefined;
        for (const follower of followers) yield* Effect.forkIn(follower, scope);
      } else {
        waiting = undefined;
        failing = Option.getOrElse(Cause.findErrorOption(built.cause), () =>
          brokenStart(Cause.squash(built.cause))
        );
      }
    });
    yield* rebuild.pipe(Effect.forever, Effect.forkIn(scope));

    const swapping = (hosted: HostedTab): HostedTab => {
      let runs = first;
      const upToDate: Effect.Effect<void, TabReadError> = Effect.suspend(() => {
        const newest = waiting ?? inForce;
        if (newest === runs) return Effect.void;
        return hosted.swap(newest).pipe(
          Effect.map(() => {
            runs = newest;
            if (newest !== waiting) return;
            inForce = newest;
            waiting = undefined;
          })
        );
      });
      return {
        listing: Effect.andThen(upToDate, hosted.listing),
        call: (tool, input) =>
          upToDate.pipe(
            Effect.mapError((error) => new RunError(error.message)),
            Effect.andThen(hosted.call(tool, input))
          ),
        inspector: {
          ...hosted.inspector,
          request: (method, params) =>
            method === "runTool"
              ? Effect.andThen(
                  upToDate,
                  hosted.inspector.request(method, params)
                )
              : hosted.inspector.request(method, params),
        },
        dialog: hosted.dialog,
        swap: () => upToDate,
      };
    };

    return {
      failing: () => failing,
      swapping,
      follow: (hosted, closed) =>
        Effect.gen(function* () {
          // A Swap that fails is told by the next listing or Run on the
          // Tab, which tries it again.
          const follower = Effect.ignore(hosted.swap(inForce));
          followers.add(follower);
          yield* closed.pipe(
            Effect.andThen(Effect.sync(() => followers.delete(follower))),
            Effect.forkIn(scope)
          );
          yield* Effect.forkIn(follower, scope);
        }),
    };
  });
