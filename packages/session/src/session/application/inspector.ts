// The Inspector on a Session: what `ayme inspect` and the Inspector window
// ask, answered on the Tab the Session works on, and what the windows are
// told.
import { Effect, Fiber, Option, Queue, Stream } from "effect";

import {
  agentAppAnswer,
  contractAnswer,
  INSPECTOR_CALLER,
  failed,
  NO_WINDOW,
  showsWindow,
  windowAnswer,
  windowEnded,
  type InspectorEvent,
  type InspectorRequest,
  type SessionAnswer,
  type SessionEnd,
} from "../domain";
import type { BrowserTabs, HostedTab } from "./sessionBrowser";

/** How often a Session reads its browser's tab list while a window
 * listens, to follow the Tab it works on: the browser tells no change of
 * the most recently active tab. */
const FOLLOW_MS = 250;

/** The Tabs of `browser` without those that show the Inspector window
 * served at `window`, so that the Session never works on it, even when the
 * person's default browser is the Session's own. */
export const withoutWindow = (
  browser: BrowserTabs,
  window: string | undefined
): BrowserTabs =>
  window === undefined
    ? browser
    : {
        open: browser.open.pipe(
          Effect.map((open) =>
            open.filter((tab) => !showsWindow(tab.url(), window))
          )
        ),
      };

/** Answers `request` of the Session named `name`, whose window is served
 * at `window` and admits an Agent App's view at `agentApp`, on the Tab
 * `chosen` gives: the Tab the Session works on. */
export const answerInspector = (
  request: InspectorRequest,
  {
    window,
    agentApp,
    name,
    chosen,
  }: {
    readonly window: string | undefined;
    readonly agentApp?: string | undefined;
    readonly name: string;
    readonly chosen: Effect.Effect<Pick<HostedTab, "inspector">, Error>;
  }
): Effect.Effect<SessionAnswer> => {
  if ("window" in request)
    return Effect.succeed(
      window === undefined ? failed(NO_WINDOW) : windowAnswer(window, name)
    );
  if ("agentApp" in request)
    return Effect.succeed(
      window === undefined || agentApp === undefined
        ? failed(NO_WINDOW)
        : agentAppAnswer(agentApp, name)
    );
  const { method, params } = request.contract;
  return chosen.pipe(
    Effect.flatMap((hosted) =>
      hosted.inspector.request(
        method,
        method === "runTool" ? asInspectorRun(params) : params
      )
    ),
    Effect.map(contractAnswer),
    Effect.catch((error) => Effect.succeed(failed(error.message)))
  );
};

/** A Run's `params` with the Inspector as its Caller: a Run over the
 * Inspector's socket is the Inspector's, whatever the window names. */
const asInspectorRun = (params: unknown) => ({
  ...(typeof params === "object" && params !== null ? params : {}),
  by: INSPECTOR_CALLER,
});

/**
 * What the windows of the Session named `name` are told, for one window
 * from when it starts listening: the contract's events of the Tab `current`
 * gives, the Tab the Session works on, which it reads again every
 * {@link FOLLOW_MS} while the window listens; a new Tab when that changes;
 * and once the Session is `ending`, how it ended, after which nothing
 * follows.
 */
export const inspectorEvents = (
  current: Effect.Effect<Pick<HostedTab, "inspector">, unknown>,
  ending: Effect.Effect<SessionEnd>,
  name: string
): Stream.Stream<InspectorEvent> =>
  Stream.callback<InspectorEvent>((queue) =>
    Effect.gen(function* () {
      // First, so that a window that listens once the Session ended hears
      // that alone: a queue that ended takes nothing more.
      yield* ending.pipe(
        Effect.map((how) => {
          Queue.offerUnsafe(queue, { ended: windowEnded(how, name) });
          Queue.endUnsafe(queue);
        }),
        Effect.forkScoped
      );
      yield* Effect.yieldNow;
      let followed:
        { readonly tab: Pick<HostedTab, "inspector"> | undefined } | undefined;
      let hearing: Fiber.Fiber<void> | undefined;
      const follow = Effect.gen(function* () {
        const tab = Option.getOrUndefined(yield* Effect.option(current));
        if (followed?.tab === tab) return;
        if (hearing) yield* Fiber.interrupt(hearing);
        if (followed) Queue.offerUnsafe(queue, { newTab: {} });
        followed = { tab };
        hearing = tab
          ? yield* tab.inspector.events.pipe(
              Stream.runForEach((event) =>
                Effect.sync(() => Queue.offerUnsafe(queue, { contract: event }))
              ),
              Effect.forkScoped
            )
          : undefined;
      });
      yield* follow.pipe(
        Effect.andThen(Effect.sleep(FOLLOW_MS)),
        Effect.forever,
        Effect.forkScoped
      );
    })
  );
