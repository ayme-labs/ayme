import {
  SETTLED_PAGE_DEADLINE_MS,
  SETTLED_PAGE_QUIET_MS,
  waitForSettled,
} from "@ayme-dev/core/structural-observation";
import { browserMonotonicClock } from "../../shared";
import type { ActionResult } from "../domain/actionResult";
import type { Cursor } from "../domain/cursors";
import type { ToolCall } from "../domain/interactionHistory";
import { watchFullLoad } from "./navigation";
import { getBrowserPageActivitySource } from "./pageActivitySource";
import { getPageStateSession } from "./pageState";
import {
  runSessionAction,
  type ActionPage,
} from "../application/sessionAction";

/**
 * Run `perform` as an action on `currentDocument` through its Page State
 * Session, as `runSessionAction` describes: a Settled Page is one with no
 * DOM, transition, animation, scroll or resize activity for a quiet window.
 */
export async function runAction(
  currentDocument: Document,
  cursor: Cursor,
  call: ToolCall,
  perform: () => unknown
): Promise<ActionResult> {
  return runSessionAction(
    getPageStateSession(currentDocument),
    documentActionPage(currentDocument),
    cursor,
    call,
    perform
  );
}

function documentActionPage(currentDocument: Document): ActionPage {
  return {
    settle: () =>
      waitForSettled({
        activity: getBrowserPageActivitySource(currentDocument),
        clock: browserMonotonicClock,
        quietMs: SETTLED_PAGE_QUIET_MS,
        deadlineMs: SETTLED_PAGE_DEADLINE_MS,
      }),
    watchFullLoad: () => watchFullLoad(currentDocument),
  };
}
