import {
  SETTLED_PAGE_DEADLINE_MS,
  SETTLED_PAGE_QUIET_MS,
  waitForSettled,
  type StructuralActionId,
} from "@ayme-dev/core/structural-observation";
import { isJsonValue, type JsonValue } from "./contracts";
import { browserMonotonicClock } from "./browserMonotonicClock";
import type { Caller, ToolCall } from "./interactionHistory";
import { getBrowserPageActivitySource } from "./pageActivitySource";
import {
  completeActionForDocument,
  failActionForDocument,
  startActionForDocument,
} from "./pageState";
import { renderChangeRecord } from "./changeRecord";

export type ActionResult = {
  result?: JsonValue;
  page_changed: boolean;
  settled: boolean;
  changes?: string;
  /** The URL a full page load started for; a redirect target is not known yet. */
  loading?: string;
  /** With `loading`: what to do next. */
  next?: string;
};

/**
 * Shared action sequence: record a Structural Action around `perform`, wait
 * for a Settled Page, capture it and return the unified action result with an
 * optional Change Record — what changed around the action: the difference
 * between the Structural Page State the acting caller last received and the
 * Settled Page after the action.
 *
 * A caller's state is what it received: `snapshot` and the Settled
 * Page of its previous action for the calling agent, each step's tree for the
 * Goal Loop's model. Captures Ayme makes for itself move neither. A change
 * that happened on its own since the caller last read the page is therefore
 * part of the record.
 *
 * An action whose `perform` or settle wait throws is completed as failed with
 * the page as it is then, moves no cursor, and the error travels on. Where
 * capturing that page or the Settled Page throws, the page as last recorded
 * stands in for it.
 *
 * An action that starts a full page load answers at once, before the old
 * document goes away, with the Change Record up to that moment, the URL that
 * is loading and `next`. `perform` and the settle wait are left to finish on
 * their own; their outcome is never reported. A navigation that stays in the
 * document leaves the action to settle as usual.
 */
export async function runAction(
  currentDocument: Document,
  caller: Caller,
  call: ToolCall,
  perform: () => unknown
): Promise<ActionResult> {
  const actionId = await startActionForDocument(currentDocument, caller, call);
  let rawResult: unknown;
  let stable = false;
  const fullLoad = watchFullLoad(currentDocument);
  let loadingUrl: string | undefined;
  try {
    const settled = (async () => {
      rawResult = await perform();
      ({ stable } = await waitForSettled({
        activity: getBrowserPageActivitySource(currentDocument),
        clock: browserMonotonicClock,
        quietMs: SETTLED_PAGE_QUIET_MS,
        deadlineMs: SETTLED_PAGE_DEADLINE_MS,
      }));
    })();
    loadingUrl = await Promise.race([
      settled.then(() => undefined),
      fullLoad.started,
    ]);
    if (loadingUrl !== undefined) settled.catch(() => {});
  } catch (error) {
    await failActionForDocument(currentDocument, actionId).catch(() => {});
    throw error;
  } finally {
    fullLoad.stop();
  }
  if (loadingUrl !== undefined)
    return loadingResult(currentDocument, actionId, loadingUrl);

  const changes = await completeActionForDocument(currentDocument, actionId);
  const pageChanged = changes.hasAnyChanges();

  const out: ActionResult = {
    page_changed: pageChanged,
    settled: stable,
  };

  if (rawResult !== undefined && isJsonValue(rawResult)) out.result = rawResult;
  if (pageChanged) out.changes = renderChangeRecord(changes);

  return out;
}

/** The answer to an action that started a full load of `url`. */
async function loadingResult(
  currentDocument: Document,
  actionId: StructuralActionId,
  url: string
): Promise<ActionResult> {
  // The document may already be going away; the answer goes out regardless.
  const changes = await completeActionForDocument(
    currentDocument,
    actionId
  ).catch(() => undefined);
  const pageChanged = changes?.hasAnyChanges() ?? false;
  return {
    page_changed: pageChanged,
    settled: false,
    ...(changes && pageChanged ? { changes: renderChangeRecord(changes) } : {}),
    loading: url,
    next: `The page is loading ${url}. Call snapshot next to read the new page.`,
  };
}

/**
 * Watch `currentDocument`'s navigations until `stop`: `started` resolves with
 * the destination URL once one starts a full load. A navigation that stays in
 * the document leaves it pending: a fragment change, a same-document
 * traversal, or one a listener intercepted, such as a router. So does one a
 * listener cancelled, and a download.
 *
 * Whether a listener intercepted it is known only after every listener ran.
 * An action starts its navigations from script, so the event is dispatched
 * on that script's stack and a microtask reads the outcome as soon as
 * dispatch has ended; the answer follows as fast as the capture allows. A
 * cross-document traversal cannot be intercepted, so for one the listeners'
 * order does not matter.
 */
function watchFullLoad(currentDocument: Document): {
  started: Promise<string>;
  stop(): void;
} {
  let resolveStarted!: (url: string) => void;
  const started = new Promise<string>((resolve) => {
    resolveStarted = resolve;
  });
  const navigation = currentDocument.defaultView?.navigation;
  if (!navigation) return { started, stop: () => {} };
  const watching = new AbortController();
  const { signal } = watching;
  navigation.addEventListener(
    "navigate",
    (event) => {
      if (event.destination.sameDocument || event.downloadRequest !== null)
        return;
      queueMicrotask(() => {
        // An intercepted navigation is in transition until its handlers end.
        const intercepted = navigation.transition !== null;
        if (!signal.aborted && !intercepted && !event.defaultPrevented)
          resolveStarted(event.destination.url);
      });
    },
    { signal }
  );
  return { started, stop: () => watching.abort() };
}
