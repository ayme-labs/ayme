// The Inspector contract (ADR-0049) of a Node Host's session, over the
// stores of the Page it drives: what a Session serves to its Inspector
// window, one contract per Tab.
import { inPage } from "../in-page";
import { renderPomDefinitions } from "../page-objects/domain";
import { getPomDefinitionsOf } from "../page-objects/infrastructure";
import { existingPageState } from "../page-state/infrastructure";
import type { AgentConnectionStatus, AppProcessTool } from "../shared";
import {
  createInspectorContract,
  type InspectorSession,
} from "./inspectorContract";
import { inspectorChannelPort } from "./inspectorChannelPort";
import { createHighlights } from "./inspectorHighlights";
import {
  lookAtInspectorStateOf,
  recordedPageStateOf,
  registeredPageObjects,
  registeredPomDefinitions,
} from "./pageInspectorLook";
import { nodeHostTargets } from "./playwrightRuntime";

const NO_PROCESS_TOOLS: readonly AppProcessTool[] = Object.freeze([]);
const OFF: AgentConnectionStatus = Object.freeze({ state: "off" });
const nothing = () => () => {};

/**
 * The Inspector contract of the Node Host `ayme`, as plain data for a
 * window outside its page: the same contract as the page's own runtime
 * serves, read from the Page the Host drives. A Node Host has no App
 * Processes, no Agent Connection, no Demo Mode and no picking: it offers no
 * tool that takes a Structural Ref, so a pick answers at once with none.
 * Stopping the last subscription ends the highlights the windows asked for.
 */
export function inspectorPortOf(ayme: InspectorSession) {
  const target = nodeHostTargets.get(ayme.tools);
  if (!target) throw new Error("This is not a Node Host's session.");
  const page = target.rawPage();
  return inspectorChannelPort(
    createInspectorContract({
      started: () => ayme,
      subscribeToStarted: nothing,
      appProcessTools: () => ({
        list: () => NO_PROCESS_TOOLS,
        subscribe: nothing,
        run: () => Promise.reject(new Error("A Node Host has no App Process.")),
      }),
      connectionStatus: () => ({ get: () => OFF, subscribe: nothing }),
      highlights: createHighlights((ref) => page.locator(`ayme-ref=${ref}`)),
      registry: {
        pageObjects: () => registeredPageObjects(target.registry()),
        pomDefinitions: () => registeredPomDefinitions(target.registry()),
        subscribe: (listener) =>
          target.registry().subscribeToRegisteredPoms(listener),
      },
      look: () =>
        lookAtInspectorStateOf({
          look: () => target.pageState().look(),
          registry: target.registry(),
          // Only a page's own runtime reads its Custom Tools' targets.
          elementToolTargets: async () => new Map(),
          controls: (refs) => inPage(page).controls(refs),
        }),
      recordedPageState: async () =>
        recordedPageStateOf(existingPageState(page)?.session.latestCapture()),
      demo: () => {},
      pomDefinitionText: (names) =>
        renderPomDefinitions(
          getPomDefinitionsOf(target.registry(), ...names).definitions
        ),
      pick: async () => undefined,
    })
  );
}
