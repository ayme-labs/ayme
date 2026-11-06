import { subscribeToRegisteredPoms } from "../page-objects/infrastructure";
import { inPage } from "../in-page";
import { requestDemoMode } from "../runs/infrastructure";
import { pageOfDocument } from "../page-state/infrastructure";
import { subscribeToAgentImageRuns } from "../tools/application";
import { getPomDefinitionText } from "../tools/infrastructure";
import type { InspectorContract } from "../shared";
import type { AppProcessTools, Ayme } from "./runtime";
import { getAgentConnectionStatus } from "./agentConnectionStatus";
import { createHighlights } from "./inspectorHighlights";
import { createInspectorContract } from "./inspectorContract";
import {
  lookAtInspectorState,
  recordedInspectorPageState,
  registeredPageObjects,
  registeredPomDefinitions,
} from "./inspectorLook";

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

/** What the contract reads of the runtime's sessions. */
export type DocumentRuntime = {
  started(): Ayme | undefined;
  subscribeToStarted(listener: () => void): () => void;
  appProcessTools(session: Ayme): AppProcessTools;
};

/**
 * The Inspector contract of the document's started session, over the
 * runtime's stores: what an Inspector in the page calls directly, and what
 * the Agent Connection relays to one outside it.
 */
export function createDocumentInspectorContract({
  started,
  subscribeToStarted,
  appProcessTools,
}: DocumentRuntime): InspectorContract {
  return createInspectorContract({
    started,
    subscribeToStarted: (listener) => subscribeToStarted(() => listener()),
    appProcessTools,
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
  });
}
