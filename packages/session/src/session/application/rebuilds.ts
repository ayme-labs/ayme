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
  /** The newest good build, which a Tab hosted now starts with. */
  readonly newest: () => BuiltPageObjects;
  /**
   * `hosted`, whose Host started with `startedWith`, swapped to the
   * Session's newest before each listing, Run and Inspector Run.
   * Its `swap` swaps them in at once, whatever it is handed, since a build
   * can be dropped while a Swap waits: put it inside the Tab's turn.
   */
  readonly swapping: (
    hosted: HostedTab,
    startedWith: BuiltPageObjects
  ) => HostedTab;
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
    // The newest good build, and on each Tab the good build it has yet to
    // swap in: a failed build drops those, and a Tab that swapped one in
    // keeps it.
    let newest = first;
    const waiting = new Set<{ pending: BuiltPageObjects | undefined }>();
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
      // Every finished build is the one a listing reports; one a newer edit
      // overtook while it ran is not swapped in.
      const overtaken = (yield* Queue.size(edited)) > 0;
      if (Exit.isFailure(built)) {
        for (const tab of waiting) tab.pending = undefined;
        failing = Option.getOrElse(Cause.findErrorOption(built.cause), () =>
          brokenStart(Cause.squash(built.cause))
        );
        return;
      }
      failing = undefined;
      if (overtaken) return;
      newest = built.value;
      for (const tab of waiting) tab.pending = built.value;
      for (const follower of followers) yield* Effect.forkIn(follower, scope);
    });
    yield* rebuild.pipe(Effect.forever, Effect.forkIn(scope));

    const swapping = (
      hosted: HostedTab,
      startedWith: BuiltPageObjects
    ): HostedTab => {
      const tab = {
        pending:
          newest === startedWith ? undefined : (newest as BuiltPageObjects),
      };
      waiting.add(tab);
      const upToDate: Effect.Effect<void, TabReadError> = Effect.suspend(() => {
        const next = tab.pending;
        if (next === undefined) return Effect.void;
        return hosted.swap(next).pipe(
          Effect.map(() => {
            if (tab.pending === next) tab.pending = undefined;
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
      newest: () => newest,
      swapping,
      follow: (hosted, closed) =>
        Effect.gen(function* () {
          // A Swap that fails is told by the next listing or Run on the
          // Tab, which tries it again.
          const follower = Effect.ignore(hosted.swap(newest));
          followers.add(follower);
          yield* closed.pipe(
            Effect.andThen(Effect.sync(() => followers.delete(follower))),
            Effect.forkIn(scope)
          );
          yield* Effect.forkIn(follower, scope);
        }),
    };
  });
