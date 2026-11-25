// Spike: the Inspector contract (ADR-0049) of a Node host's session over a
// real Playwright Page, as plain data for `ayme mcp` to relay to an external
// Inspector window. The same contract as the browser's, over the Page-keyed
// stores instead of the document's. What a Node host has no part of (App
// Processes, the Agent Connection's status, agent images, Demo Mode, Custom
// Tools' targets) it answers as empty or off.
import type { Page } from "@playwright/test";
import type { InspectorPort } from "@ayme-dev/mcp/client";

import { inPage } from "../in-page";
import { renderPageState } from "../page-state/domain";
import { existingPageState } from "../page-state/infrastructure";
import { renderPomDefinitions } from "../page-objects/domain";
import { getPomDefinitionsOf } from "../page-objects/infrastructure";
import type { PomRegistry } from "../page-objects/application";
import type {
  InspectorLook,
  InspectorPageObject,
  InspectorRootedInstance,
  InspectorTarget,
  PomDefinition,
} from "../shared";
import type { PageStateStore } from "../page-state/infrastructure";
import { createInspectorContract, type InspectorSession } from "./inspectorContract";
import { inspectorChannelPort } from "./inspectorChannelPort";
import { createHighlights } from "./inspectorHighlights";

const plain = <T>(value: unknown): T =>
  JSON.parse(JSON.stringify(value)) as T;

/** The session's Inspector contract over `page`, as plain data. */
export function playwrightInspectorPort({
  session,
  page,
  registry,
  pageState,
}: {
  session: InspectorSession;
  page: Page;
  registry: () => PomRegistry;
  pageState: () => PageStateStore;
}): InspectorPort {
  const contract = createInspectorContract({
    started: () => session,
    subscribeToStarted: () => () => {},
    appProcessTools: () => ({
      list: () => [],
      subscribe: () => () => {},
      run: () => Promise.reject(new Error("A Node session has no App Processes.")),
    }),
    connectionStatus: () => ({
      get: () => ({ state: "connected", agent: "ayme (node session)" }),
      subscribe: () => () => {},
    }),
    subscribeToAgentImageRuns: () => () => {},
    highlights: createHighlights((ref) => page.locator(`ayme-ref=${ref}`)),
    registry: {
      pageObjects: () =>
        registry()
          .listRegisteredPoms()
          .map((pom) =>
            plain<InspectorPageObject>({
              id: pom.id,
              manifest: pom.manifest,
              memberObservations: pom.memberObservations,
              presentPaths: [...pom.presentPaths],
              rootMemberPaths: [...pom.rootMemberPaths],
              tools: pom.tools,
            })
          ),
      pomDefinitions: () => {
        try {
          return plain<PomDefinition[]>(
            getPomDefinitionsOf(registry()).definitions
          );
        } catch {
          return [];
        }
      },
      subscribe: (listener) => registry().subscribeToRegisteredPoms(listener),
    },
    look: () => look(page, registry(), pageState()),
    recordedPageState: async () => {
      const capture = existingPageState(page)?.session.latestCapture();
      if (!capture) return undefined;
      return {
        projected: plain(
          renderPageState({ tree: capture.tree, pomRootMarks: new Map() })
            .projected
        ),
        refs: [...capture.tree.getAllRefs()],
      };
    },
    demo: () => {},
    pomDefinitionText: (names) =>
      renderPomDefinitions(getPomDefinitionsOf(registry(), ...names).definitions),
    pick: (refs, signal) => inPage(page).pick(refs, { signal }),
  });
  return inspectorChannelPort(contract);
}

/** `lookAtInspectorState` over a Playwright page's stores. */
async function look(
  page: Page,
  registry: PomRegistry,
  pageState: PageStateStore
): Promise<InspectorLook> {
  const state = await pageState.look();
  const [targets, rooted] = await Promise.all([
    registry.listRegisteredPomTargets(),
    registry.listRootedToolInstances(),
  ]);
  const refs = [...state.tree.getAllRefs()];
  const inLook = new Set<string>(refs);
  const refOf = (ref: string) => (inLook.has(ref) ? ref : undefined);
  const plainTargets: InspectorTarget[] = targets.map(
    ({ ref, path, locator, aliases }) => {
      const named = refOf(ref);
      return {
        path,
        locator,
        ...(aliases === undefined ? {} : { aliases: [...aliases] }),
        ...(named === undefined ? {} : { ref: named }),
      };
    }
  );
  const targetsByRef: Record<string, string[]> = {};
  for (const target of plainTargets)
    if (target.ref !== undefined)
      (targetsByRef[target.ref] ??= []).push(target.path);
  const rootedInstances: Record<string, InspectorRootedInstance[]> = {};
  for (const [name, instances] of rooted)
    rootedInstances[name] = instances.map(({ id, ref, available, reason }) => {
      const named = refOf(ref);
      return {
        id,
        ...(named === undefined ? {} : { ref: named }),
        available,
        ...(reason === undefined ? {} : { reason }),
      };
    });
  return {
    projected: plain(state.projected),
    refs,
    targets: plainTargets,
    targetsByRef,
    elementToolTargets: {},
    controls: await inPage(page).controls(refs),
    rootedInstances,
  };
}
