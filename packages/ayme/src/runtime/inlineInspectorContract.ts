import { subscribeToRegisteredPoms } from "../page-objects/infrastructure";
import { inPage } from "../in-page";
import { requestDemoMode } from "../runs/infrastructure";
import { pageOfDocument } from "../page-state/infrastructure";
import { subscribeToAgentImageRuns } from "../tools/application";
import { getPomDefinitionText } from "../tools/infrastructure";
import type { InspectorContract } from "../shared";
import { getAgentConnectionStatus } from "./agentConnectionStatus";
import { createHighlights } from "./inspectorHighlights";
import { createInspectorContract } from "./inspectorContract";
import {
  lookAtInspectorState,
  recordedInspectorPageState,
  registeredPageObjects,
  registeredPomDefinitions,
} from "./inspectorLook";
import {
  getAppProcessTools,
  getStartedAyme,
  subscribeToStartedAyme,
} from "./runtime";

/** The Inspector's own host on the page, which picking leaves alone. */
const INSPECTOR_HOST = "[data-ayme-inspector-host]";

let releaseDemo: (() => void) | undefined;

/** The Inspector's own request for Demo Mode, held until it withdraws it. */
function askForDemoMode(on: boolean) {
  if (on) releaseDemo ??= requestDemoMode();
  else {
    releaseDemo?.();
    releaseDemo = undefined;
  }
}

let served: InspectorContract | undefined;

/**
 * The Inspector contract of the runtime's started session, served directly:
 * what the inline Inspector calls, with no serialization. One per document.
 */
export function inlineInspectorContract(): InspectorContract {
  return (served ??= createInspectorContract({
    started: getStartedAyme,
    subscribeToStarted: (listener) => subscribeToStartedAyme(() => listener()),
    appProcessTools: getAppProcessTools,
    connectionStatus: getAgentConnectionStatus,
    subscribeToAgentImageRuns,
    registry: {
      pageObjects: registeredPageObjects,
      pomDefinitions: registeredPomDefinitions,
      subscribe: (listener) => subscribeToRegisteredPoms(listener),
    },
    look: lookAtInspectorState,
    recordedPageState: async () => recordedInspectorPageState(),
    demo: askForDemoMode,
    pomDefinitionText: (names) => getPomDefinitionText(...names),
    highlights: createHighlights((ref) =>
      pageOfDocument(document).locator(`ayme-ref=${ref}`)
    ),
    pick: (refs, signal) =>
      inPage(pageOfDocument(document)).pick(refs, {
        ignore: INSPECTOR_HOST,
        signal,
      }),
  }));
}
