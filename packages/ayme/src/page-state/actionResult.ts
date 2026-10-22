// What an action answers: its result and its Change Record, in two parts.

import type { StructuralObservationEntry } from "@ayme-dev/core/structural-observation";
import type { JsonValue } from "../shared";
import { renderChangeRecord } from "./changeRecord";
import type { InteractionHistory } from "./interactionHistory";

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
 * The Change Record a failed action's error carries, on the error itself:
 * what changed before the action and what it changed before it failed.
 */
export type ActionFailure = Pick<
  ActionResult,
  "page_changed" | "changes_before" | "changes"
>;

/**
 * The sentence every action tool's description ends with: how the result
 * reports what changed, in two parts, and the limit of the second.
 */
export const ACTION_RESULT_NOTE =
  "The result's changes_before lists what changed on the page since you last received it, before this action; changes lists what the action changed, anything that changed while the page settled after it included.";

/**
 * Give a failed action's error its Change Record, under the names an action
 * result gives them. An error that fails an enclosing action too ends up with
 * that action's record instead, which covers the inner one's, as its result
 * would.
 */
export function attachChangeRecord(
  error: Error & Partial<ActionFailure>,
  record: Pick<ActionResult, "page_changed" | "changes_before" | "changes">
) {
  error.page_changed = record.page_changed;
  for (const name of ["changes_before", "changes"] as const)
    if (record[name]) error[name] = record[name];
    else delete error[name];
}

/** Where an action's Change Record is read from: its two starts. */
export type ChangeRecordStarts = {
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
export async function readChangeRecord(
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
      ? {
          changes_before: renderChangeRecord(changesBefore!, {
            before: history.pomLabels(received!),
            after: history.pomLabels(start),
          }),
        }
      : {}),
    ...(actionChanged
      ? {
          changes: renderChangeRecord(changes, {
            before: history.pomLabels(start),
            after: history.pomLabels(after),
          }),
        }
      : {}),
  };
}
