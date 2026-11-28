import { browserRegistry } from "../page-objects/infrastructure";
import { inPage } from "../in-page";
import { actionsSettled } from "../runs/infrastructure";
import {
  latestPageStateCapture,
  pageOfDocument,
  lookAtPageStateForDocument,
} from "../page-state/infrastructure";
import type {
  InspectorLook,
  InspectorPageObject,
  InspectorRecordedPageState,
  PomDefinition,
} from "../shared";
import {
  lookAtInspectorStateOf,
  recordedPageStateOf,
  registeredPageObjects as pageObjectsIn,
  registeredPomDefinitions as pomDefinitionsIn,
} from "./pageInspectorLook";
import { listElementToolTargets } from "./publishedTools";

/**
 * One unrecorded look at the document, as plain data for the Inspector
 * contract. It reads the page once the runtime's running page actions have
 * settled, as they need the main thread it holds.
 */
export function lookAtInspectorState(): Promise<InspectorLook> {
  return lookAtInspectorStateOf({
    look: () =>
      lookAtPageStateForDocument(document, () => actionsSettled(document)),
    registry: browserRegistry(),
    elementToolTargets: listElementToolTargets,
    controls: (refs) => inPage(pageOfDocument(document)).controls(refs),
  });
}

/** The latest page state the document's runtime recorded, as plain data.
 * Reads the record only: nothing is captured. */
export function recordedInspectorPageState():
  InspectorRecordedPageState | undefined {
  return recordedPageStateOf(latestPageStateCapture(document));
}

/** The document's registered Page Objects as plain data. */
export function registeredPageObjects(): InspectorPageObject[] {
  return pageObjectsIn(browserRegistry());
}

/** The document's Page Object Model definitions, as snapshot describes
 * them; none when they cannot be read. */
export function registeredPomDefinitions(): PomDefinition[] {
  return pomDefinitionsIn(browserRegistry());
}
