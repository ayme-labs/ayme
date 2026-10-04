import { useCallback, useEffect, useRef, useState } from "react";

import type { PomDefinition, RegisteredPomTool } from "@ayme-dev/ayme";
import type {
  PageStatePeek,
  ProjectedStructuralNodeForest,
  RegisteredPom,
  RegisteredPomTarget,
} from "@ayme-dev/ayme/internal";

import {
  getPomDefinitions,
  listElementToolTargets,
  listRegisteredPomTargets,
  listRegisteredPomTools,
  listRegisteredPoms,
  peekPageStateForDocument,
  subscribeToRegisteredPoms,
} from "@ayme-dev/ayme/internal";

import type { HighlightTarget } from "../../navigation/domain/highlight";
import { readControls, type ControlState } from "./formControls";
import { createRefreshScheduler } from "./refreshScheduler";
import { mapTargetsToRefs } from "../../structure/domain/structure";

export type RegistrySnapshot = {
  registeredPoms: readonly RegisteredPom[];
  /** The tools callable now, by name: the ones WebMCP publishes. */
  activeTools: ReadonlyMap<string, RegisteredPomTool>;
  /** The Page Object Model definitions snapshot returns. */
  pomDefinitions: readonly PomDefinition[];
};

export type PageStateView = {
  /** The projected page state: the forest an agent's text is rendered from. */
  projected?: ProjectedStructuralNodeForest;
  /** The registry targets' paths whose element each ref is, by ref. */
  targetsByRef: ReadonlyMap<string, readonly string[]>;
  /**
   * The refs each published single-element tool can take in this page state, by tool
   * name, in tree order: what an agent is offered for that tool's ref.
   */
  elementToolTargets: ReadonlyMap<string, readonly string[]>;
  /** Each ref's element in this page state. */
  elementsByRef: ReadonlyMap<string, Element>;
  /** The native form controls' states, by ref, read with this look. */
  controls: ReadonlyMap<string, ControlState>;
  capturedAt?: string;
  error?: string;
  loading: boolean;
};

/** While the Structure view shows, how often it looks at the page anyway. */
const STRUCTURE_POLL_MS = 2000;

function readRegistry(): RegistrySnapshot {
  return {
    registeredPoms: listRegisteredPoms(),
    activeTools: new Map(
      listRegisteredPomTools().map((tool) => [tool.name, tool])
    ),
    pomDefinitions: readPomDefinitions(),
  };
}

function readPomDefinitions() {
  try {
    return getPomDefinitions().definitions;
  } catch (error) {
    // snapshot fails the same way, e.g. on an ambiguous definition.
    console.warn(
      `Could not read the page object models: ${errorMessage(error)}`
    );
    return [];
  }
}

/**
 * The Inspector's live view of the page. Each refresh takes one unrecorded
 * look at the page state (a peek: it never enters the interaction history,
 * so agents see exactly what they would without the Inspector), and that one
 * look feeds the member mapping (the structure is built from it), the Ref
 * Tools' targets and the highlights. Page changes, input, focus and registry changes schedule
 * refreshes; while the Structure view shows, a slow poll catches the rest.
 */
export function useInspector({
  structureVisible = false,
  targetsOf = noTargets,
}: {
  structureVisible?: boolean;
  /**
   * The registry target paths a highlight's path stands for, read as each
   * highlight shows, e.g. the roots of a collection's items.
   */
  targetsOf?: (path: string) => ReadonlySet<string>;
} = {}) {
  const [registry, setRegistry] = useState(readRegistry);
  const [pageState, setPageState] = useState<PageStateView>({
    targetsByRef: new Map(),
    elementToolTargets: new Map(),
    elementsByRef: new Map(),
    controls: new Map(),
    loading: false,
  });

  const mounted = useRef(false);
  const latest = useRef<Look>(undefined);
  const layers = useRef<Record<HighlightLayer, LayerState>>({
    hover: { elements: [] },
    pinned: { elements: [] },
  });

  const resolve = useRef(targetsOf);
  useEffect(() => {
    resolve.current = targetsOf;
  }, [targetsOf]);

  /** Shows a layer's highlight on the target's elements in the latest look. */
  const showLayer = useCallback((layer: HighlightLayer) => {
    const state = layers.current[layer];
    const elements =
      state.target && latest.current
        ? targetElements(state.target, latest.current, resolve.current)
        : [];
    markElements(layer, state.elements, elements);
    state.elements = elements;
  }, []);

  const look = useCallback(async () => {
    setPageState((current) => ({ ...current, loading: true }));
    try {
      const next = await lookAtPage();
      if (!mounted.current) return;
      latest.current = next;
      for (const layer of highlightLayers) showLayer(layer);
      setPageState({
        projected: next.peek.projected,
        targetsByRef: next.targetsByRef,
        elementToolTargets: next.elementToolTargets,
        elementsByRef: next.peek.elementsByRef,
        controls: readControls(next.peek.elementsByRef),
        capturedAt: new Date().toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        }),
        loading: false,
      });
    } catch (error) {
      if (!mounted.current) return;
      setPageState((current) => ({
        ...current,
        error: errorMessage(error),
        loading: false,
      }));
    }
  }, [showLayer]);

  const [scheduler] = useState(() => createRefreshScheduler(() => look()));
  const refreshPageState = useCallback(() => scheduler.request(), [scheduler]);

  /** The dashed highlight: what the pointer is over in the panel, if anything. */
  const hover = useCallback(
    (target: HighlightTarget | undefined) => {
      layers.current.hover.target = target;
      showLayer("hover");
    },
    [showLayer]
  );

  /** The solid highlight: the selection's element(s), if it has any. */
  const pin = useCallback(
    (target: HighlightTarget | undefined) => {
      layers.current.pinned.target = target;
      showLayer("pinned");
    },
    [showLayer]
  );

  useEffect(() => {
    mounted.current = true;

    // Changes to the page, except the Inspector's own marks on it.
    const observer = new MutationObserver((records) => {
      if (!records.every(isInspectorOwnMutation)) scheduler.request();
    });
    observer.observe(document.body, {
      attributes: true,
      childList: true,
      characterData: true,
      subtree: true,
    });
    // Typing, checking and focus change the page state without mutating the
    // DOM. Events from inside the Inspector reach here from its host.
    const onPageEvent = (event: Event) => {
      if (!isFromInspector(event)) scheduler.request();
    };
    const pageEvents = ["input", "change", "focusin", "focusout"] as const;
    for (const type of pageEvents)
      document.addEventListener(type, onPageEvent, true);

    const updateRegistry = () => {
      setRegistry(readRegistry());
      scheduler.request();
    };
    updateRegistry();
    const unsubscribe = subscribeToRegisteredPoms(updateRegistry);

    const layerStates = layers.current;
    return () => {
      mounted.current = false;
      observer.disconnect();
      for (const type of pageEvents)
        document.removeEventListener(type, onPageEvent, true);
      scheduler.dispose();
      for (const layer of highlightLayers) {
        const state = layerStates[layer];
        markElements(layer, state.elements, []);
        state.elements = [];
      }
      unsubscribe();
    };
  }, [scheduler]);

  // Open shadow roots in the app and CSS-only state change nothing the
  // observer or the listeners see; look again now and then while it shows.
  useEffect(() => {
    if (!structureVisible) return;
    const poll = setInterval(() => scheduler.request(), STRUCTURE_POLL_MS);
    return () => clearInterval(poll);
  }, [scheduler, structureVisible]);

  return {
    ...registry,
    pageState,
    refreshPageState,
    highlight: { hover, pin },
  };
}

/** One look at the page, and what the Inspector reads from it. */
type Look = {
  peek: PageStatePeek;
  targets: readonly RegisteredPomTarget[];
  /** The page state's elements: only these can be highlighted. */
  elementsInState: ReadonlySet<Element>;
  targetsByRef: ReadonlyMap<string, readonly string[]>;
  elementToolTargets: ReadonlyMap<string, readonly string[]>;
};

/**
 * Peeks at the page state and maps each ref to every registry target whose
 * element it is: an element's ref is its only ref in the peek.
 */
async function lookAtPage(): Promise<Look> {
  const peek = await peekPageStateForDocument(document);
  const [targets, elementToolTargets] = await Promise.all([
    listRegisteredPomTargets(),
    listElementToolTargets(peek),
  ]);

  // Several members can hold the same element (two collections over the
  // same items, or a locator over a collection's items); none hides another.
  const targetsByRef = mapTargetsToRefs(peek.elementsByRef, targets);

  return {
    peek,
    targets,
    elementsInState: new Set(peek.elementsByRef.values()),
    targetsByRef,
    elementToolTargets,
  };
}

/**
 * A target's elements in a look: a ref's element, or the elements of the
 * registry targets a path stands for, as far as the page state shows them.
 */
function targetElements(
  target: HighlightTarget,
  look: Look,
  targetsOf: (path: string) => ReadonlySet<string>
): Element[] {
  if ("ref" in target) {
    const element = [...look.peek.elementsByRef].find(
      ([ref]) => ref === target.ref
    )?.[1];
    return element ? [element] : [];
  }
  const paths = targetsOf(target.path);
  return [
    ...new Set(
      look.targets
        .filter(({ path }) => paths.has(path))
        .map(({ element }) => element)
        .filter((element) => look.elementsInState.has(element))
    ),
  ];
}

const noTargets = () => new Set<string>();

type HighlightLayer = "hover" | "pinned";

const highlightLayers: readonly HighlightLayer[] = ["hover", "pinned"];

/** The host attribute of each layer; the host style draws them. */
const layerAttribute: Record<HighlightLayer, string> = {
  hover: "data-ayme-hover",
  pinned: "data-ayme-highlight",
};

type LayerState = {
  target?: HighlightTarget;
  elements: Element[];
};

function markElements(
  layer: HighlightLayer,
  previous: readonly Element[],
  next: readonly Element[]
) {
  const attribute = layerAttribute[layer];
  for (const element of previous)
    if (!next.includes(element)) element.removeAttribute(attribute);
  for (const element of next) element.setAttribute(attribute, "");
}

const INSPECTOR_HOST = "[data-ayme-inspector-host]";

/** Attributes the Inspector itself puts on the page. */
const ownAttributes = new Set([
  "data-ayme-highlight",
  "data-ayme-hover",
  "data-ayme-pick-unusable",
]);

function isInspectorOwnMutation(record: MutationRecord) {
  return (
    (record.type === "attributes" &&
      ownAttributes.has(record.attributeName ?? "")) ||
    (record.target instanceof Element && record.target.matches(INSPECTOR_HOST))
  );
}

function isFromInspector(event: Event) {
  return (
    event.target instanceof Element &&
    event.target.closest(INSPECTOR_HOST) !== null
  );
}

export function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
