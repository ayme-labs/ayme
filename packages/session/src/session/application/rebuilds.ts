// The Session's Page Objects across edits: it builds them again when their
// source changes, and swaps a good build in on each Tab between its Runs
// (rule 7).
import { Cause, Effect, Exit, Option, Queue, Scope, Stream } from "effect";

import { brokenStart, SessionStartError } from "../domain";
import type { BuiltPageObjects, PageObjectsBuild } from "./pageObjectsBuild";
import type { HostedTab } from "./sessionBrowser";

/** A hosted Tab as the Session's commands reach it, whose Swaps the Session
 * makes itself. */
export type SwappingTab = Omit<HostedTab, "swap"> & {
  /** Why the last finished build failed, or why the Tab could not register
   * the last good build it tried, while that is so: what its listings say
   * after their Tab line (rule 7). */
  readonly failing: () => SessionStartError | undefined;
};

/** Takes the Tab's turn for `work`: one Run, listing or Swap at a time. */
export type InTurn = <A, E>(work: Effect.Effect<A, E>) => Effect.Effect<A, E>;

/** The Session's Page Objects as its builds leave them. */
export interface Rebuilds {
  /** The newest good build, which a Tab hosted now starts with. */
  readonly newest: () => BuiltPageObjects;
  /**
   * `hosted`, whose Host started with `startedWith`, brought to the newest
   * good build before each listing, Run and Inspector Run, and in its turn
   * after each good build, as `inTurn` takes it, until the Tab is
   * `closed`. Put the listings and Runs it returns in that turn too.
   */
  readonly swapping: (
    hosted: HostedTab,
    startedWith: BuiltPageObjects,
    turn: { readonly inTurn: InTurn; readonly closed: Effect.Effect<void> }
  ) => Effect.Effect<SwappingTab>;
}

/** A hosted Tab as the builds reach it: the good build it has yet to swap
 * in, why it could not register the last one it tried, and what wakes its
 * Swaps. */
type FollowingTab = {
  pending: BuiltPageObjects | undefined;
  refused: SessionStartError | undefined;
  readonly wake: Queue.Queue<void>;
};

/**
 * Builds the Session's Page Objects again after each edit `builds` tells
 * of, from the `first` build, in `scope`. The newest edit wins: a build
 * that finishes after a newer edit is not swapped in, and the next one
 * starts. A good build waits for its Swap until a Tab's turn, and is
 * dropped on each Tab that has not swapped it in when a later edit fails to
 * build; a failed build swaps nothing in.
 */
export const rebuilding = (
  first: BuiltPageObjects,
  builds: PageObjectsBuild["Service"],
  scope: Scope.Scope
): Effect.Effect<Rebuilds> =>
  Effect.gen(function* () {
    let newest = first;
    let failing: SessionStartError | undefined;
    const tabs = new Set<FollowingTab>();
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
        for (const tab of tabs) tab.pending = undefined;
        failing = Option.getOrElse(Cause.findErrorOption(built.cause), () =>
          brokenStart(Cause.squash(built.cause))
        );
        return;
      }
      failing = undefined;
      if (overtaken) return;
      newest = built.value;
      for (const tab of tabs) {
        tab.pending = built.value;
        yield* Queue.offer(tab.wake, undefined);
      }
    });
    yield* rebuild.pipe(Effect.forever, Effect.forkIn(scope));

    return {
      newest: () => newest,
      swapping: (hosted, startedWith, { inTurn, closed }) =>
        Effect.gen(function* () {
          // One wake stands for every good build since the last Swap.
          const tab: FollowingTab = {
            pending: newest === startedWith ? undefined : newest,
            refused: undefined,
            wake: yield* Queue.sliding<void>(1),
          };
          tabs.add(tab);
          // A build the Tab cannot register is a failed build there: the
          // Tab keeps its classes and does not try that build again.
          const upToDate: Effect.Effect<void> = Effect.suspend(() => {
            const next = tab.pending;
            if (next === undefined) return Effect.void;
            tab.pending = undefined;
            return hosted.swap(next).pipe(
              Effect.match({
                onSuccess: () => (tab.refused = undefined),
                onFailure: (error) =>
                  (tab.refused = new SessionStartError(error.message)),
              })
            );
          });
          if (tab.pending !== undefined)
            yield* Queue.offer(tab.wake, undefined);
          yield* Queue.take(tab.wake).pipe(
            Effect.andThen(inTurn(upToDate)),
            Effect.forever,
            Effect.raceFirst(closed),
            Effect.ensuring(Effect.sync(() => tabs.delete(tab))),
            Effect.forkIn(scope)
          );
          return {
            listing: Effect.andThen(upToDate, hosted.listing),
            call: (tool, input) =>
              Effect.andThen(upToDate, hosted.call(tool, input)),
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
            failing: () => failing ?? tab.refused,
          } satisfies SwappingTab;
        }),
    };
  });
