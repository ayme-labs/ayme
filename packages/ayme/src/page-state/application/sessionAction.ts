import type { StructuralActionId } from "@ayme-dev/core/structural-observation";
import { isJsonValue } from "../../shared";
import type { Cursor } from "../domain/cursors";
import type { ToolCall } from "../domain/interactionHistory";
import type { PageStateSession } from "./pageStateSession";
import {
  attachChangeRecord,
  readChangeRecord,
  type ActionResult,
  type ChangeRecordStarts,
} from "../domain/actionResult";

/** The page signals an action waits on, besides its session's captures. */
export type ActionPage = {
  /**
   * Wait for a Settled Page, bounded by a deadline; `stable` says whether
   * the page became stable before it.
   */
  settle(): Promise<{ stable: boolean }>;
  /**
   * Watch the page's navigations until `stop`: `started` resolves with the
   * destination URL once one starts a full page load.
   */
  watchFullLoad(): { started: Promise<string>; stop(): void };
};

/**
 * The action sequence: record a Structural Action around `perform`, wait
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
 * the page as it is then, and the error travels on; one whose `perform`
 * throws still waits for a Settled Page first. The error's message then ends
 * with the Change Record's parts that have a change, and `cursor` moves to
 * that page, as the Caller received it: what a failed action did still
 * reaches its Caller once. Where capturing that page or the Settled Page
 * throws, the page as last recorded stands in for it.
 *
 * An action that starts a full page load answers at once, before the old
 * document goes away, with the Change Record up to that moment, the URL that
 * is loading and `next`. `perform` and the settle wait are left to finish on
 * their own; their outcome is never reported. A navigation that stays in the
 * document leaves the action to settle as usual.
 */
export async function runSessionAction(
  session: PageStateSession,
  page: ActionPage,
  cursor: Cursor,
  call: ToolCall,
  perform: () => unknown
): Promise<ActionResult> {
  const actionId = await session.startAction(call);
  const history = session.history;
  // The start of the Change Record: where the cursor stands as the action
  // starts; child Runs inside the action move the cursor on.
  const received = history.received(cursor);
  // The page as last observed: the action's before unless the before
  // capture finds the page moved on since.
  let before = history.latestObservation;
  let rawResult: unknown;
  let stable = false;
  const fullLoad = page.watchFullLoad();
  let loadingUrl: string | undefined;
  try {
    before = (await session.captureBefore(actionId)) ?? before;
    const waitForSettledPage = () => page.settle();
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
    await session
      .failAction(actionId)
      .then(async (after) => {
        if (!(error instanceof Error)) return;
        const record = await readChangeRecord(
          history,
          { received, before },
          after
        );
        // An error that cannot take the fields, such as a frozen one, leaves
        // the cursor where it was: the next action reports these changes.
        attachChangeRecord(error, record);
        cursor.move(after);
      })
      .catch(() => {});
    throw error;
  } finally {
    fullLoad.stop();
  }
  if (loadingUrl !== undefined)
    return loadingResult(
      session,
      actionId,
      cursor,
      { received, before },
      loadingUrl
    );

  const after = await session.completeAction(actionId);
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

/** The answer to an action that started a full load of `url`. */
async function loadingResult(
  session: PageStateSession,
  actionId: StructuralActionId,
  cursor: Cursor,
  starts: ChangeRecordStarts,
  url: string
): Promise<ActionResult> {
  // The document may already be going away; the answer goes out regardless.
  const record = await session
    .completeAction(actionId)
    .then((after) => {
      cursor.move(after);
      return readChangeRecord(session.history, starts, after);
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
