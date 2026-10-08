import {
  SETTLED_PAGE_DEADLINE_MS,
  SETTLED_PAGE_QUIET_MS,
  waitForSettled,
  type StructuralActionId,
  type StructuralObservationEntry,
} from "@ayme-dev/core/structural-observation";
import { isJsonValue, type JsonValue } from "./contracts";
import { browserMonotonicClock } from "./browserMonotonicClock";
import type { Cursor } from "./cursors";
import type { ToolCall } from "./interactionHistory";
import { getBrowserPageActivitySource } from "./pageActivitySource";
import {
  captureBeforeActionForDocument,
  completeActionForDocument,
  failActionForDocument,
  getInteractionHistory,
  startActionForDocument,
} from "./pageState";
import type { InteractionHistory } from "./interactionHistory";
import { renderChangeRecord } from "./changeRecord";

export type ActionResult = {
  result?: JsonValue;
  /** Whether either part of the Change Record has a change. */
  page_changed: boolean;
  settled: boolean;
  /**
   * What changed on the page since the Caller last received it, before the
   * action ran: on its own, or by another Caller. Absent when nothing did.
   */
  changes_before?: string;
  /** What the action changed; absent when nothing. */
  changes?: string;
  /** The URL a full page load started for; a redirect target is not known yet. */
  loading?: string;
  /** With `loading`: what to do next. */
  next?: string;
};

/**
 * The sentence every action tool's description ends with: how the result
 * reports what changed, in two parts, and the limit of the second.
 */
export const ACTION_RESULT_NOTE =
  "The result's changes_before lists what changed on the page since you last received it, before this action; changes lists what the action changed, anything that changed while the page settled after it included.";

/**
 * Shared action sequence: record a Structural Action around `perform`, wait
 * for a Settled Page, capture it and return the unified action result with
 * the Change Record in two parts: `changes_before`, what changed between the
 * Structural Page State `cursor` stands at, the one its Caller last
 * received, and the page right before the action; and `changes`, what
 * changed from there to the Settled Page after the action, where `cursor`
 * then moves.
 *
 * A Caller's state is what it received: `snapshot` and the Settled Page of
 * its previous action; each step's tree for the Goal Loop's fork. Captures
 * Ayme makes for itself move no cursor: the before capture, taken right
 * before `perform` and recorded only when the page differs from the latest
 * observation, is one. A change that happened on its own since the Caller
 * last read the page, or by another Caller, is therefore in
 * `changes_before`; one that lands while the page settles after the action
 * counts as the action's.
 *
 * An action whose `perform` or settle wait throws is completed as failed with
 * the page as it is then, moves no cursor, and the error travels on; one
 * whose `perform` throws still waits for a Settled Page first. Where
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
  cursor: Cursor,
  call: ToolCall,
  perform: () => unknown
): Promise<ActionResult> {
  const actionId = await startActionForDocument(currentDocument, call);
  const history = getInteractionHistory(currentDocument);
  // The start of the Change Record: where the cursor stands as the action
  // starts; child Runs inside the action move the cursor on.
  const received = history.received(cursor);
  // The page as last observed: the action's before unless the before
  // capture finds the page moved on since.
  let before = history.latestObservation;
  let rawResult: unknown;
  let stable = false;
  const fullLoad = watchFullLoad(currentDocument);
  let loadingUrl: string | undefined;
  try {
    before =
      (await captureBeforeActionForDocument(currentDocument, actionId)) ??
      before;
    const waitForSettledPage = () =>
      waitForSettled({
        activity: getBrowserPageActivitySource(currentDocument),
        clock: browserMonotonicClock,
        quietMs: SETTLED_PAGE_QUIET_MS,
        deadlineMs: SETTLED_PAGE_DEADLINE_MS,
      });
    const settled = (async () => {
      try {
        rawResult = await perform();
      } catch (error) {
        // What a failed action set off settles before its Run's turn ends.
        await waitForSettledPage().catch(() => {});
        throw error;
      }
      ({ stable } = await waitForSettledPage());
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
    return loadingResult(
      currentDocument,
      actionId,
      cursor,
      { received, before },
      loadingUrl
    );

  const after = await completeActionForDocument(currentDocument, actionId);
  cursor.move(after);
  const record = await readChangeRecord(history, { received, before }, after);

  const out: ActionResult = {
    page_changed: record.page_changed,
    settled: stable,
  };

  if (rawResult !== undefined && isJsonValue(rawResult)) out.result = rawResult;
  if (record.changes_before) out.changes_before = record.changes_before;
  if (record.changes) out.changes = record.changes;

  return out;
}

/** Where an action's Change Record is read from: its two starts. */
type ChangeRecordStarts = {
  /** Where the Caller's cursor stood as the action started. */
  received: StructuralObservationEntry | undefined;
  /** The page right before the action: its before capture, else the latest observation. */
  before: StructuralObservationEntry | undefined;
};

/**
 * Read an action's Change Record through core, in its two parts: from the
 * Caller's cursor to the action's before, and from there to `after`. A part
 * with nothing to read, or no change, is left out.
 */
async function readChangeRecord(
  history: InteractionHistory,
  { received, before }: ChangeRecordStarts,
  after: StructuralObservationEntry
): Promise<Pick<ActionResult, "page_changed" | "changes_before" | "changes">> {
  const start = before ?? after;
  const [changesBefore, changes] = await Promise.all([
    received && received !== start
      ? history.readChange(received, start)
      : undefined,
    history.readChange(start, after),
  ]);
  const beforeChanged = changesBefore?.hasAnyChanges() ?? false;
  const actionChanged = changes.hasAnyChanges();
  return {
    page_changed: beforeChanged || actionChanged,
    ...(beforeChanged
      ? { changes_before: renderChangeRecord(changesBefore!) }
      : {}),
    ...(actionChanged ? { changes: renderChangeRecord(changes) } : {}),
  };
}

/**
 * Calls the browser Page's `navigate`, such as `goto` or `reload`, without
 * waiting for its outcome, which may be a load this document never sees.
 * Resolves once the navigation starts in this document, or once the call
 * ends without starting one. A Page that defers the call, as the Inspector's
 * demo mode does, so cannot leave the action settled before its navigation
 * begins. Without the Navigation API, which tells when it starts, waits for
 * the call to end; such a browser cannot answer a full load at once anyway.
 */
export async function startNavigation(
  currentDocument: Document,
  navigate: () => Promise<unknown>
): Promise<void> {
  const navigation = currentDocument.defaultView?.navigation;
  const watching = new AbortController();
  // Listening before the call, which may start the navigation at once.
  const started = new Promise<void>((resolve) =>
    navigation?.addEventListener("navigate", () => resolve(), {
      signal: watching.signal,
    })
  );
  const ended = navigate().then(
    () => {},
    () => {}
  );
  if (!navigation) return ended;
  try {
    await Promise.race([started, ended]);
  } finally {
    watching.abort();
  }
}

/** The answer to an action that started a full load of `url`. */
async function loadingResult(
  currentDocument: Document,
  actionId: StructuralActionId,
  cursor: Cursor,
  starts: ChangeRecordStarts,
  url: string
): Promise<ActionResult> {
  // The document may already be going away; the answer goes out regardless.
  const record = await completeActionForDocument(currentDocument, actionId)
    .then((after) => {
      cursor.move(after);
      return readChangeRecord(
        getInteractionHistory(currentDocument),
        starts,
        after
      );
    })
    .catch(
      (): Pick<
        ActionResult,
        "page_changed" | "changes_before" | "changes"
      > => ({
        page_changed: false,
      })
    );
  return {
    page_changed: record.page_changed,
    settled: false,
    ...(record.changes_before ? { changes_before: record.changes_before } : {}),
    ...(record.changes ? { changes: record.changes } : {}),
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
