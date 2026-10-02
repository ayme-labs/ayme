import {
  SETTLED_PAGE_DEADLINE_MS,
  SETTLED_PAGE_QUIET_MS,
  waitForSettled,
  type StructuralTree,
} from "@ayme-dev/core/structural-observation";
import { isJsonValue, type JsonValue } from "./contracts";
import { browserMonotonicClock } from "./browserMonotonicClock";
import type { Caller, ToolCall } from "./interactionHistory";
import { getBrowserPageActivitySource } from "./pageActivitySource";
import {
  completeActionForDocument,
  failActionForDocument,
  failActionWithoutCaptureForDocument,
  startActionForDocument,
} from "./pageState";
import { renderChangeRecord } from "./changeRecord";

export type ActionResult = {
  result?: JsonValue;
  page_changed: boolean;
  settled: boolean;
  changes?: string;
};

/**
 * Shared action sequence: record a Structural Action around `perform`, wait
 * for a Settled Page, capture it and return the unified action result with an
 * optional Change Record — what changed around the action: the difference
 * between the Structural Page State the acting caller last received and the
 * Settled Page after the action.
 *
 * A caller's state is what it received: `get_page_context` and the Settled
 * Page of its previous action for the calling agent, each step's tree for the
 * Goal Loop's model. Captures Ayme makes for itself move neither. A change
 * that happened on its own since the caller last read the page is therefore
 * part of the record.
 *
 * An action whose `perform` throws is completed as failed with the page as it
 * is then, moves no cursor, and the error travels on. When waiting for the
 * Settled Page or capturing it throws, the action is completed as failed with
 * the page as last recorded instead.
 */
export async function runAction(
  currentDocument: Document,
  caller: Caller,
  call: ToolCall,
  perform: () => unknown
): Promise<ActionResult> {
  const actionId = await startActionForDocument(currentDocument, caller, call);
  let rawResult: unknown;
  try {
    rawResult = await perform();
  } catch (error) {
    await failActionForDocument(currentDocument, actionId).catch(() => {});
    throw error;
  }
  let stable: boolean;
  let changes: StructuralTree;
  try {
    ({ stable } = await waitForSettled({
      activity: getBrowserPageActivitySource(currentDocument),
      clock: browserMonotonicClock,
      quietMs: SETTLED_PAGE_QUIET_MS,
      deadlineMs: SETTLED_PAGE_DEADLINE_MS,
    }));
    changes = await completeActionForDocument(currentDocument, actionId);
  } catch (error) {
    await failActionWithoutCaptureForDocument(currentDocument, actionId).catch(
      () => {}
    );
    throw error;
  }
  const pageChanged = changes.hasAnyChanges();

  const out: ActionResult = {
    page_changed: pageChanged,
    settled: stable,
  };

  if (rawResult !== undefined && isJsonValue(rawResult)) out.result = rawResult;
  if (pageChanged) out.changes = renderChangeRecord(changes);

  return out;
}
