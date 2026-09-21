import {
  SETTLED_PAGE_DEADLINE_MS,
  SETTLED_PAGE_QUIET_MS,
  waitForSettled,
} from "@ayme-dev/core/structural-observation";
import { isJsonValue, type JsonValue } from "./contracts";
import { browserMonotonicClock } from "./browserMonotonicClock";
import { getBrowserPageActivitySource } from "./pageActivitySource";
import { captureChangeRecordForDocument } from "./pageState";
import { renderChangeRecord } from "./changeRecord";

export type ActionResult = {
  result?: JsonValue;
  page_changed: boolean;
  settled: boolean;
  changes?: string;
};

/**
 * Shared post-action sequence: wait for a Settled Page, capture it and return
 * the unified action result with an optional Change Record — what changed
 * around the action: the difference between the Structural Page State the
 * caller last received and the Settled Page after the action.
 *
 * The caller's state comes from `get_page_context`, from the Settled Page of
 * the previous action and from the tree a Goal Loop step sent to the model;
 * captures Ayme makes for itself leave it untouched. A change that happened on
 * its own since the caller last read the page is therefore part of the record.
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

  const changes = await captureChangeRecordForDocument(currentDocument);
  const pageChanged = changes?.hasAnyChanges() ?? false;

  const out: ActionResult = {
    page_changed: pageChanged,
    settled: stable,
  };

  if (rawResult !== undefined && isJsonValue(rawResult)) out.result = rawResult;
  if (changes !== null && pageChanged)
    out.changes = renderChangeRecord(changes);

  return out;
}
