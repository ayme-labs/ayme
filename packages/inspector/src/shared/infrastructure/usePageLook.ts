import { useCallback, useEffect, useRef, useState } from "react";

import type { PomDefinition, RegisteredPomTool } from "@ayme-dev/ayme";
import type {
  PageStateLook,
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
  lookAtPageStateForDocument,
  subscribeToRegisteredPoms,
} from "@ayme-dev/ayme/internal";

import type { ControlState } from "../domain/controlState";
import { mapTargetsToRefs } from "../domain/targetsByRef";
import { readControls } from "./formControls";
import { createRefreshScheduler } from "./refreshScheduler";

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
 * look at the page state (it never enters the interaction history,
 * so agents see exactly what they would without the Inspector), and that one
 * look feeds the member mapping (the structure is built from it), the Ref
 * Tools' targets and, through `onLook`, the highlights. Page changes, input,
 * focus and registry changes schedule refreshes; while the Structure view
 * shows, a slow poll catches the rest.
 */
export function usePageLook({
  structureVisible,
  onLook,
}: {
  /** Whether the Structure view shows, so the page is looked at often. */
  structureVisible: boolean;
  /** Called with each new look, before the page state it gives shows. */
  onLook: (look: Look) => void;
}) {
  const [registry, setRegistry] = useState(readRegistry);
  const [pageState, setPageState] = useState<PageStateView>({
    targetsByRef: new Map(),
    elementToolTargets: new Map(),
    elementsByRef: new Map(),
    controls: new Map(),
    loading: false,
  });

  const mounted = useRef(false);
  const lookListener = useRef(onLook);
  useEffect(() => {
    lookListener.current = onLook;
  }, [onLook]);

  const look = useCallback(async () => {
    setPageState((current) => ({ ...current, loading: true }));
    try {
      const next = await lookAtPage();
      if (!mounted.current) return;
      lookListener.current(next);
      setPageState({
        projected: next.state.projected,
        targetsByRef: next.targetsByRef,
        elementToolTargets: next.elementToolTargets,
        elementsByRef: next.state.elementsByRef,
        controls: readControls(next.state.elementsByRef),
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
  }, []);

  const [scheduler] = useState(() => createRefreshScheduler(() => look()));
  const refreshPageState = useCallback(() => scheduler.request(), [scheduler]);

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

    return () => {
      mounted.current = false;
      observer.disconnect();
      for (const type of pageEvents)
        document.removeEventListener(type, onPageEvent, true);
      scheduler.dispose();
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

  return { ...registry, pageState, refreshPageState };
}

/** One look at the page, and what the Inspector reads from it. */
export type Look = {
  state: PageStateLook;
  targets: readonly RegisteredPomTarget[];
  /** The page state's elements: only these can be highlighted. */
  elementsInState: ReadonlySet<Element>;
  targetsByRef: ReadonlyMap<string, readonly string[]>;
  elementToolTargets: ReadonlyMap<string, readonly string[]>;
};

/**
 * Looks at the page state and maps each ref to every registry target whose
 * element it is: an element's ref is its only ref in the look.
 */
async function lookAtPage(): Promise<Look> {
  const state = await lookAtPageStateForDocument(document);
  const [targets, elementToolTargets] = await Promise.all([
    listRegisteredPomTargets(),
    listElementToolTargets(state),
  ]);

  // Several members can hold the same element (two collections over the
  // same items, or a locator over a collection's items); none hides another.
  const targetsByRef = mapTargetsToRefs(state.elementsByRef, targets);

  return {
    state,
    targets,
    elementsInState: new Set(state.elementsByRef.values()),
    targetsByRef,
    elementToolTargets,
  };
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
