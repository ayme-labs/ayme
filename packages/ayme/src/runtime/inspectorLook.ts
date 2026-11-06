import {
  getPomDefinitions,
  listRegisteredPomTargets,
  listRegisteredPoms,
  listRootedToolInstances,
} from "../page-objects/infrastructure";
import { renderPageState } from "../page-state/domain";
import {
  latestPageStateCapture,
  lookAtPageStateForDocument,
} from "../page-state/infrastructure";
import type {
  ControlState,
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
  const [targets, elementToolTargets] = await Promise.all([
    listRegisteredPomTargets(),
    listElementToolTargets(state),
  ]);
  // An element's ref is its only ref in the look; an element with several has none.
  const refsByElement = new Map<Element, string[]>();
  for (const [ref, element] of state.elementsByRef)
    refsByElement.set(element, [...(refsByElement.get(element) ?? []), ref]);
  const refOf = (element: Element): string | undefined => {
    const refs = refsByElement.get(element);
    return refs?.length === 1 ? refs[0] : undefined;
  };

  const plainTargets: InspectorTarget[] = targets.map(
    ({ element, path, locator, aliases }) => {
      const ref = refOf(element);
      return {
        path,
        locator,
        ...(aliases === undefined ? {} : { aliases: [...aliases] }),
        ...(ref === undefined ? {} : { ref }),
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
  for (const [name, instances] of listRootedToolInstances())
    rootedInstances[name] = instances.map(({ element, available, reason }) => {
      const ref = refOf(element);
      return {
        ...(ref === undefined ? {} : { ref }),
        available,
        ...(reason === undefined ? {} : { reason }),
      };
    });

  return {
    projected: JSON.parse(JSON.stringify(state.projected)),
    refs: [...state.elementsByRef.keys()],
    targets: plainTargets,
    targetsByRef,
    elementToolTargets: Object.fromEntries(
      [...elementToolTargets].map(([name, refs]) => [name, [...refs]])
    ),
    controls: Object.fromEntries(readControls(state.elementsByRef)),
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
    refs: [...capture.elementsByRef.keys()],
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

/** The controls' state of each native form control, by ref: inputs, textareas and selects. */
export function readControls(
  elementsByRef: ReadonlyMap<string, Element>
): Map<string, ControlState> {
  const controls = new Map<string, ControlState>();
  const forms = new Map<HTMLFormElement | null, number>();
  for (const [ref, element] of elementsByRef) {
    const control = controlOf(element, (form) => {
      if (!forms.has(form)) forms.set(form, forms.size);
      return forms.get(form)!;
    });
    if (control) controls.set(ref, control);
  }
  return controls;
}

function controlOf(
  element: Element,
  formIndex: (form: HTMLFormElement | null) => number
): ControlState | undefined {
  if (element instanceof HTMLTextAreaElement)
    return { value: element.value, multiline: true };
  if (element instanceof HTMLSelectElement)
    return {
      value: element.selectedOptions[0]?.label ?? "",
      options: [...element.options].map((option) => option.label),
    };
  if (!(element instanceof HTMLInputElement)) return undefined;
  switch (element.type) {
    case "checkbox":
      return { value: String(element.checked) };
    case "radio":
      return {
        value: String(element.checked),
        ...(element.name
          ? { group: `${formIndex(element.form)}:${element.name}` }
          : {}),
      };
    case "range":
      return {
        value: element.value,
        range: {
          min: numberOr(element.min, 0),
          max: numberOr(element.max, 100),
          step:
            element.step.toLowerCase() === "any"
              ? "any"
              : numberOr(element.step, 1),
        },
      };
    default:
      return { value: element.value };
  }
}

function numberOr(text: string, fallback: number) {
  const value = Number.parseFloat(text);
  return Number.isFinite(value) ? value : fallback;
}
