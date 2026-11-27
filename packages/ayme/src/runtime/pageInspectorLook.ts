// The Inspector's look at a Host's page as plain data, over the stores it
// is handed: the Page-keyed twin of inspectorLook.ts, which reads the
// browser's own document, so that the ./playwright entry needs no document.
import type { PomRegistry } from "../page-objects/application";
import { getPomDefinitionsOf } from "../page-objects/infrastructure";
import {
  renderPageState,
  type PageStateCapture,
  type PageStateLook,
} from "../page-state/domain";
import type {
  InspectorLook,
  InspectorPageObject,
  InspectorRecordedPageState,
  InspectorRootedInstance,
  InspectorTarget,
  PomDefinition,
} from "../shared";

/** What a look reads of a Host's page. */
export type LookSources = {
  /** One unrecorded capture of the page, asking for every predicate. */
  look(): Promise<PageStateLook>;
  readonly registry: Pick<
    PomRegistry,
    "listRegisteredPomTargets" | "listRootedToolInstances"
  >;
  /** The refs of `state` each Custom Tool can act on, by the tool's name. */
  elementToolTargets(
    state: PageStateLook
  ): Promise<ReadonlyMap<string, readonly string[]>>;
  /** The native controls' states of `refs`, read in the page. */
  controls(refs: readonly string[]): Promise<InspectorLook["controls"]>;
};

/**
 * One unrecorded look at a Host's page, as plain data for the Inspector
 * contract: the projected Structural Page State with its refs, each
 * registered target named by the ref of its element, each rooted tool's item
 * by its Page Object id and that ref, and the native controls' states.
 * Records nothing and moves no cursor.
 */
export async function lookAtInspectorStateOf({
  look,
  registry,
  elementToolTargets: toolTargets,
  controls,
}: LookSources): Promise<InspectorLook> {
  const state = await look();
  const [targets, elementToolTargets, rooted] = await Promise.all([
    registry.listRegisteredPomTargets(),
    toolTargets(state),
    registry.listRootedToolInstances(),
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
    projected: JSON.parse(JSON.stringify(state.projected)),
    refs,
    targets: plainTargets,
    targetsByRef,
    elementToolTargets: Object.fromEntries(
      [...elementToolTargets].map(([name, refs]) => [name, [...refs]])
    ),
    controls: await controls(refs),
    rootedInstances,
  };
}

/** `capture`, a page state a Host recorded, as plain data: the projected
 * forest its text renders (without the Page Object Root Marks, which name
 * no element) and its refs. */
export function recordedPageStateOf(
  capture: PageStateCapture | undefined
): InspectorRecordedPageState | undefined {
  if (!capture) return undefined;
  return {
    projected: plain(
      renderPageState({ tree: capture.tree, pomRootMarks: new Map() }).projected
    ),
    refs: [...capture.tree.getAllRefs()],
  };
}

/** The Page Objects registered in `registry` as plain data: no instance, and sets as lists. */
export function registeredPageObjects(
  registry: Pick<PomRegistry, "listRegisteredPoms">
): InspectorPageObject[] {
  return registry.listRegisteredPoms().map((pom) =>
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
export function registeredPomDefinitions(
  registry: PomRegistry
): PomDefinition[] {
  try {
    return plain<PomDefinition[]>(getPomDefinitionsOf(registry).definitions);
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
