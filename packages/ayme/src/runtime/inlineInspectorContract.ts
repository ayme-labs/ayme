import { inPage } from "../in-page";
import { pageOfDocument } from "../page-state/infrastructure";
import { subscribeToAgentImageRuns } from "../tools/application";
import type { InspectorContract } from "../shared";
import { getAgentConnectionStatus } from "./agentConnectionStatus";
import { createHighlights } from "./inspectorHighlights";
import { createInspectorContract } from "./inspectorContract";
import {
  getAppProcessTools,
  getStartedAyme,
  subscribeToStartedAyme,
} from "./runtime";

/** The Inspector's own host on the page, which picking leaves alone. */
const INSPECTOR_HOST = "[data-ayme-inspector-host]";

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
