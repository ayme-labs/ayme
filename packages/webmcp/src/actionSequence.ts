import {
  SETTLED_PAGE_DEADLINE_MS,
  SETTLED_PAGE_QUIET_MS,
  StructuralTree,
  waitForSettled,
} from "@ayme-dev/core/structural-observation";
import { isJsonValue, type JsonValue } from "./contracts";
import { browserMonotonicClock } from "./browserMonotonicClock";
import { getBrowserPageActivitySource } from "./pageActivitySource";
import { getPageStateCaptureForDocument } from "./pageState";
import { renderChangeRecord } from "./changeRecord";

export type ActionResult = {
  result?: JsonValue;
  page_changed: boolean;
  settled: boolean;
  changes?: string;
};

/**
 * Shared post-action sequence: wait for a Settled Page, capture the resulting
 * Structural Page State, reconcile against the state the action was decided on,
 * and return the unified action result with an optional Change Record.
 *
 * The caller must have captured the page state (via resolvePageStateRefsForAction
 * or getPageStateCaptureForDocument) before executing the action, so the Page
 * State Session baseline matches the decision state.
 */
export async function completeAction(
  currentDocument: Document,
  rawResult?: unknown
): Promise<ActionResult> {
  const { stable } = await waitForSettled({
    activity: getBrowserPageActivitySource(currentDocument),
    clock: browserMonotonicClock,
    quietMs: SETTLED_PAGE_QUIET_MS,
    deadlineMs: SETTLED_PAGE_DEADLINE_MS,
  });

  const afterCapture = await getPageStateCaptureForDocument(currentDocument);
  const reconciled = afterCapture.reconcile;
  const pageChanged = reconciled !== null && reconciled.hasAnyChanges();

  const out: ActionResult = {
    page_changed: pageChanged,
    settled: stable,
  };

  if (rawResult !== undefined && isJsonValue(rawResult)) out.result = rawResult;
  if (pageChanged && reconciled !== null)
    out.changes = renderChangeRecord(reconciled);

  return out;
}
