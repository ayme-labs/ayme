import {
  getPomDefinitions,
  listRegisteredPomTargets,
  listRegisteredPoms,
  listRootedToolInstances,
} from "../page-objects/infrastructure";
import { inPage } from "../in-page";
import { renderPageState } from "../page-state/domain";
import {
  latestPageStateCapture,
  pageOfDocument,
  lookAtPageStateForDocument,
} from "../page-state/infrastructure";
import type {
  InspectorLook,
  InspectorPageObject,
  InspectorRecordedPageState,
  InspectorRootedInstance,
  InspectorTarget,
  PomDefinition,
} from "../shared";
import { listElementToolTargets } from "./publishedTools";

/**
 * One unrecorded look at the document, as plain data for the Inspector
 * contract: the projected Structural Page State with its refs, each
 * registered target and rooted tool's item named by the ref of its element,
 * and the native controls' states. Records nothing and moves no cursor.
 */
export async function lookAtInspectorState(): Promise<InspectorLook> {
  const state = await lookAtPageStateForDocument(document);
  const [targets, elementToolTargets, rooted] = await Promise.all([
    listRegisteredPomTargets(),
    listElementToolTargets(state),
    listRootedToolInstances(),
  ]);
  const refs = [...state.tree.getAllRefs()];
  // A target or instance names its element by a ref of the look, or by none.
  const inLook = new Set<string>(refs);
  const refOf = (ref: string): string | undefined =>
    inLook.has(ref) ? ref : undefined;

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
      targetsByRef[target.ref] = [
        ...(targetsByRef[target.ref] ?? []),
        target.path,
      ];

  const rootedInstances: Record<string, InspectorRootedInstance[]> = {};
  for (const [name, instances] of rooted)
    rootedInstances[name] = instances.map(({ ref, available, reason }) => {
      const named = refOf(ref);
      return {
        ...(named === undefined ? {} : { ref: named }),
        available,
        ...(reason === undefined ? {} : { reason }),
      };
    });

  return {
    projected: JSON.parse(JSON.stringify(state.projected)),
    refs,
    targets: plainTargets,
    targetsByRef,
    elementToolTargets: Object.fromEntries(
      [...elementToolTargets].map(([name, refs]) => [name, [...refs]])
    ),
    controls: await inPage(pageOfDocument(document)).controls(refs),
    rootedInstances,
  };
}

/**
 * The latest page state the runtime recorded, as plain data: the projected
 * forest its text renders (without the Page Object Root Marks, which name no
 * element) and its refs. Reads the record only: nothing is captured.
 */
export function recordedInspectorPageState():
  InspectorRecordedPageState | undefined {
  const capture = latestPageStateCapture(document);
  if (!capture) return undefined;
  return {
    projected: plain(
      renderPageState({ tree: capture.tree, pomRootMarks: new Map() }).projected
    ),
    refs: [...capture.tree.getAllRefs()],
  };
}

/** The registered Page Objects as plain data: no instance, and sets as lists. */
export function registeredPageObjects(): InspectorPageObject[] {
  return listRegisteredPoms().map((pom) =>
    plain<InspectorPageObject>({
      id: pom.id,
      manifest: pom.manifest,
      memberObservations: pom.memberObservations,
      presentPaths: [...pom.presentPaths],
      rootMemberPaths: [...pom.rootMemberPaths],
      tools: pom.tools,
    })
  );
}

/** The Page Object Model definitions, as snapshot describes them; none when they cannot be read. */
export function registeredPomDefinitions(): PomDefinition[] {
  try {
    return plain<PomDefinition[]>(getPomDefinitions().definitions);
  } catch (error) {
    // snapshot fails the same way, e.g. on an ambiguous definition.
    console.warn(
      `Could not read the page object models: ${error instanceof Error ? error.message : String(error)}`
    );
    return [];
  }
}

/**
 * Plain data: JSON's shape, so an instance, a function or an `undefined`
 * field never crosses the contract.
 */
function plain<T>(value: unknown): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
