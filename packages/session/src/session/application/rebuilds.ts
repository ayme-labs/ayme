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

/** A hosted Tab as the Session's commands reach it, whose Swaps the Session
 * makes itself. */
export type SwappingTab = Omit<HostedTab, "swap">;

/** Takes the Tab's turn for `work`: one Run, listing or Swap at a time. */
export type InTurn = <A, E>(work: Effect.Effect<A, E>) => Effect.Effect<A, E>;

/** The Session's Page Objects as its builds leave them. */
export interface Rebuilds {
  /** Why the last finished build failed, while it is the last: a build
   * still under way changes nothing yet. */
  readonly failing: () => SessionStartError | undefined;
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
 * in, and what wakes its Swaps. */
type FollowingTab = {
  pending: BuiltPageObjects | undefined;
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
      failing: () => failing,
      newest: () => newest,
      swapping: (hosted, startedWith, { inTurn, closed }) =>
        Effect.gen(function* () {
          // One wake stands for every good build since the last Swap.
          const tab: FollowingTab = {
            pending: newest === startedWith ? undefined : newest,
            wake: yield* Queue.sliding<void>(1),
          };
          tabs.add(tab);
          const upToDate: Effect.Effect<void, TabReadError> = Effect.suspend(
            () => {
              const next = tab.pending;
              if (next === undefined) return Effect.void;
              return hosted.swap(next).pipe(
                Effect.map(() => {
                  if (tab.pending === next) tab.pending = undefined;
                })
              );
            }
          );
          // A Swap that fails is told by the next listing or Run on the Tab,
          // which tries it again.
          if (tab.pending !== undefined)
            yield* Queue.offer(tab.wake, undefined);
          yield* Queue.take(tab.wake).pipe(
            Effect.andThen(inTurn(Effect.ignore(upToDate))),
            Effect.forever,
            Effect.raceFirst(closed),
            Effect.ensuring(Effect.sync(() => tabs.delete(tab))),
            Effect.forkIn(scope)
          );
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
          } satisfies SwappingTab;
        }),
    };
  });
