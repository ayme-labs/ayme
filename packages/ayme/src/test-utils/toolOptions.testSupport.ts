/**
 * Test support: the options the Goal Loop would offer on `page` now, from a
 * look at the document that carries the refs each predicate keeps, measured
 * with Chromium's geometry.
 */
import type { Page } from "@playwright/test";

import { buildToolOptions } from "../goal-loop/application";
import {
  geometryReach,
  lookAtPageStateForDocument,
} from "../page-state/infrastructure";

export async function toolOptionsOf(page: Page) {
  return buildToolOptions(
    { page, reach: geometryReach },
    await lookAtPageStateForDocument(document)
  );
}
