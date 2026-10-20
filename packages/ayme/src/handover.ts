/**
 * The Handover: what the Goal Loop hands the calling agent when it stops. The
 * Goal Loop's contract with its Caller; the loop and the Step Decision both
 * build it, nothing in here decides.
 */

import type { JsonValue } from "./contracts";

export type HandoverReason =
  | "done"
  | "no_fitting_option"
  | "needs_value"
  | "action_failed"
  | "no_progress"
  | "step_budget"
  | "decide_failed"
  | "page_loading";

/** The option the model chose for one parameter, exactly as it was offered. */
export type ChosenOption = { key: string; description: string };

/**
 * One executed step, as the loop knew it at the step. The same record is a
 * Handover's `history` entry, an entry of the `history` the model is sent, and
 * the base of the step's run record.
 */
export type GoalLoopStepRecord = {
  /** The tool's name; a Page Object tool's is its qualified name. */
  operation: string;
  /** Per parameter asked: the option the model chose, exactly as offered. */
  chosen: Record<string, ChosenOption>;
  /** `"ok"`, or the error the action failed with. */
  result: string;
  page_changed: boolean;
  /**
   * What the action returned, when it returned a value: a Custom Tool's or
   * Page Object tool's result, the only trace of an effect the page does not
   * show. Bounded to `MAX_STEP_RETURNED` characters of JSON.
   */
  returned?: JsonValue;
  /**
   * What the action changed on the page, its Change Record, cut to
   * `MAX_STEP_CHANGES` characters. Absent when the action changed nothing,
   * even where `page_changed` counts a change made while the model decided.
   */
  changes?: string;
  /** A one-line label derived from the fields above; nothing reads it back. */
  did: string;
};

export type HandoverHistoryEntry = GoalLoopStepRecord;

export type HandoverNeeds = {
  tool: string;
  parameters: string[];
};

export type Handover = {
  reason: HandoverReason;
  next: string;
  history: HandoverHistoryEntry[];
  needs?: HandoverNeeds;
  /**
   * With `page_loading`: the URL the full page load the last step started
   * was for.
   */
  loading?: string;
  /**
   * The run's Change Record: the page the calling agent last received against
   * the page the loop last received, in the notation of `ActionResult.changes`.
   * Absent when nothing changed.
   */
  changes?: string;
};
