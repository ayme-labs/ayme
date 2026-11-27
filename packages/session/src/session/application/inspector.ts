// The Inspector on a Session: what `ayme inspect` and the Inspector window
// ask, answered on the Tab the windows show, and what the windows are told.
import { Effect, Fiber, Queue, Scope, Stream } from "effect";

import {
  agentAppAnswer,
  ANOTHER_TAB_SHOWN,
  contractAnswer,
  INSPECTOR_CALLER,
  failed,
  inspectorEnded,
  NO_TAB_OPEN,
  NO_WINDOW,
  showsWindow,
  TabReadError,
  windowAnswer,
  type InspectorEvent,
  type InspectorRequest,
  type SessionAnswer,
  type SessionEnd,
} from "../domain";
import type { BrowserTab, BrowserTabs, HostedTab } from "./sessionBrowser";

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

/** A Tab the windows may show: the Session's Tab, and its Host. */
export type ShowableTab = {
  readonly tab: BrowserTab;
  readonly hosted: HostedTab;
};

/** The Tab the windows of a Session show, followed for them all at once. */
export interface ShownTabs {
  /** What one window is told, from when it starts listening: first the
   * Tab it shows, once the Session read its tab list, then the contract's
   * events of that Tab, each new Tab, and how the Session ended. */
  readonly events: Stream.Stream<InspectorEvent>;
  /** The Tab the windows were told as `tab`, while they still show it;
   * none when they show that no tab is open. */
  readonly shown: (
    tab: number
  ) => Effect.Effect<ShowableTab | undefined, TabReadError>;
}

/**
 * Follows the Tab `active` gives, the one the Session works on, for every
 * window of the Session named `name` at once: it reads it again every
 * {@link FOLLOW_MS} while at least one window listens, and stops when the
 * last one stops or the Session is `ending`. Its work runs in `scope`.
 */
export function followTabs(
  active: Effect.Effect<ShowableTab | undefined, unknown>,
  ending: Effect.Effect<SessionEnd>,
  name: string,
  scope: Scope.Scope
): ShownTabs {
  const listeners = new Set<(event: InspectorEvent) => void>();
  // Rises with each Tab the windows are told, so no number is told twice.
  let told = 0;
  // What the windows were told, while the Session follows the Tab.
  let shown:
    | { readonly tab: number; readonly showing: ShowableTab | undefined }
    | undefined;
  let following: Fiber.Fiber<unknown> | undefined;
  const tell = (event: InspectorEvent) => {
    for (const listener of [...listeners]) listener(event);
  };
  /** Tells the windows the Tab they show from now on, and forwards its
   * contract's events while the returned fiber runs. */
  const show = (showing: ShowableTab | undefined) =>
    Effect.gen(function* () {
      shown = { tab: ++told, showing };
      tell({ tab: shown.tab });
      if (!showing) return undefined;
      return yield* showing.hosted.inspector.events.pipe(
        Stream.runForEach((event) =>
          Effect.sync(() => tell({ contract: event }))
        ),
        Effect.forkChild
      );
    });
  const follow = Effect.gen(function* () {
    let hearing: Fiber.Fiber<unknown> | undefined;
    for (;;) {
      const read = yield* Effect.result(active);
      // A failed read says nothing of a change, so the Tab last told
      // stays; the first read, failed or not, tells the windows something.
      const changed =
        read._tag === "Success"
          ? shown === undefined || shown.showing?.tab !== read.success?.tab
          : shown === undefined;
      if (changed) {
        if (hearing) yield* Fiber.interrupt(hearing);
        hearing = yield* show(
          read._tag === "Success" ? read.success : undefined
        );
      }
      yield* Effect.sleep(FOLLOW_MS);
    }
  });
  const start = Effect.suspend(() =>
    following
      ? Effect.void
      : Effect.raceFirst(follow, ending).pipe(
          Effect.forkIn(scope),
          Effect.map((fiber) => void (following = fiber))
        )
  );
  const stop = Effect.suspend(() => {
    const fiber = following;
    if (listeners.size > 0 || !fiber) return Effect.void;
    following = undefined;
    shown = undefined;
    return Fiber.interrupt(fiber);
  });
  return {
    events: Stream.callback<InspectorEvent>((queue) =>
      Effect.gen(function* () {
        // First, so that a window that listens once the Session ended hears
        // that alone: a queue that ended takes nothing more.
        yield* ending.pipe(
          Effect.map((how) => {
            Queue.offerUnsafe(queue, inspectorEnded(how, name));
            Queue.endUnsafe(queue);
          }),
          Effect.forkScoped
        );
        yield* Effect.yieldNow;
        const listener = (event: InspectorEvent) =>
          void Queue.offerUnsafe(queue, event);
        yield* Effect.acquireRelease(
          Effect.sync(() => {
            listeners.add(listener);
            if (shown) listener({ tab: shown.tab });
          }),
          () =>
            Effect.sync(() => listeners.delete(listener)).pipe(
              Effect.andThen(stop)
            )
        );
        yield* start;
      })
    ),
    shown: (tab) =>
      Effect.suspend(() =>
        shown?.tab === tab
          ? Effect.succeed(shown.showing)
          : Effect.fail(new TabReadError(ANOTHER_TAB_SHOWN))
      ),
  };
}

/** Answers `request` of the Session named `name`, whose window `opening`
 * gives the address of, each time with a code of its own, and admits an
 * Agent App's view at `agentApp`. A call on the contract is made on the Tab
 * it names, as `shown` gives it, or on the Tab `chosen` gives, the one the
 * Session works on, when it names none; a Run of a tool that takes a Page
 * Object Id is refused when `idElsewhere` says the id is of another Tab. */
export const answerInspector = (
  request: InspectorRequest,
  {
    opening,
    agentApp,
    name,
    shown,
    chosen,
    idElsewhere,
  }: {
    readonly opening: (() => string) | undefined;
    readonly agentApp: string | undefined;
    readonly name: string;
    readonly shown: ShownTabs["shown"];
    readonly chosen: Effect.Effect<HostedTab, Error>;
    readonly idElsewhere: (
      on: BrowserTab,
      call: { readonly tool: string; readonly input: unknown }
    ) => string | undefined;
  }
): Effect.Effect<SessionAnswer> => {
  if ("window" in request)
    return Effect.sync(() =>
      opening === undefined ? failed(NO_WINDOW) : windowAnswer(opening(), name)
    );
  if ("agentApp" in request)
    return Effect.succeed(
      agentApp === undefined
        ? failed(NO_WINDOW)
        : agentAppAnswer(agentApp, name)
    );
  const { method, params, tab } = request.contract;
  const on: Effect.Effect<HostedTab, Error> =
    tab === undefined
      ? chosen
      : shown(tab).pipe(
          Effect.flatMap((showing) => {
            if (!showing) return Effect.fail(new TabReadError(NO_TAB_OPEN));
            const elsewhere =
              method === "runTool"
                ? idElsewhere(showing.tab, toolCallOf(params))
                : undefined;
            return elsewhere === undefined
              ? Effect.succeed(showing.hosted)
              : Effect.fail(new TabReadError(elsewhere));
          })
        );
  return on.pipe(
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

/** The tool and input a Run's `params` name. */
const toolCallOf = (params: unknown) => {
  const { name, input } = (params ?? {}) as {
    readonly name?: unknown;
    readonly input?: unknown;
  };
  return { tool: typeof name === "string" ? name : "", input };
};

/** A Run's `params` with the Inspector as its Caller: a Run over the
 * Inspector's socket is the Inspector's, whatever the window names. */
const asInspectorRun = (params: unknown) => ({
  ...(typeof params === "object" && params !== null ? params : {}),
  by: INSPECTOR_CALLER,
});
