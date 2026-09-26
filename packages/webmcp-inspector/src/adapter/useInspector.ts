import { useCallback, useEffect, useRef, useState } from "react";

import type { AriaRef, PageState, RegisteredPomTool } from "@ayme-dev/webmcp";
import type { RegisteredPom } from "@ayme-dev/webmcp/internal";

import {
  getPageStateForElements,
  listRegisteredPomTargets,
  listRegisteredPomTools,
  listRegisteredPoms,
  subscribeToRegisteredPoms,
} from "@ayme-dev/webmcp/internal";

import {
  buildStructureTree,
  emptyStructure,
  memberOfTarget,
  type MemberMapping,
  type StructureTree,
} from "./structure";

export type RegistrySnapshot = {
  registeredPoms: readonly RegisteredPom[];
  /** The tools callable now, by name: the ones WebMCP publishes. */
  activeTools: ReadonlyMap<string, RegisteredPomTool>;
};

export type PageStateView = {
  text?: string;
  /** The same page state, as the structure tree model. */
  structure: StructureTree;
  capturedAt?: string;
  error?: string;
  loading: boolean;
};

function readRegistry(): RegistrySnapshot {
  return {
    registeredPoms: listRegisteredPoms(),
    activeTools: new Map(
      listRegisteredPomTools().map((tool) => [tool.name, tool])
    ),
  };
}

export function useInspector() {
  const [registry, setRegistry] = useState(readRegistry);
  const [pageState, setPageState] = useState<PageStateView>({
    structure: emptyStructure,
    loading: false,
  });
  const [pinned, setPinned] = useState<HighlightTarget>();

  const mounted = useRef(false);
  const pageStateRequestId = useRef(0);
  const highlightRequestId = useRef(0);
  const latestPageState = useRef<PageState>(undefined);
  const highlightedElements = useRef<Element[]>([]);
  const pinnedTarget = useRef<HighlightTarget>(undefined);
  const hoveredTarget = useRef<HighlightTarget>(undefined);

  const refreshPageState = useCallback(async () => {
    const requestId = ++pageStateRequestId.current;
    const isCurrent = () =>
      mounted.current && requestId === pageStateRequestId.current;
    setPageState((current) => ({
      ...current,
      error: undefined,
      loading: true,
    }));

    try {
      const { state, structure } = await captureStructure();
      if (!isCurrent()) return;
      latestPageState.current = state;
      setPageState({
        text: state.text,
        structure,
        capturedAt: new Date().toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        }),
        loading: false,
      });
    } catch (error) {
      if (!isCurrent()) return;
      setPageState((current) => ({
        ...current,
        error: errorMessage(error),
        loading: false,
      }));
    }
  }, []);

  const clearHighlightedElements = useCallback(() => {
    for (const element of highlightedElements.current)
      element.removeAttribute("data-ayme-highlight");
    highlightedElements.current = [];
  }, []);

  const applyHighlight = useCallback(
    async (target: HighlightTarget | undefined) => {
      const requestId = ++highlightRequestId.current;
      const isCurrent = () =>
        mounted.current && requestId === highlightRequestId.current;
      clearHighlightedElements();
      if (!target) return;

      try {
        const resolutions = await resolveHighlightTarget(
          target,
          latestPageState.current
        );
        const elements = uniqueElements(
          resolutions.flatMap((resolution) =>
            resolution.status === "resolved" ? [resolution.node.element] : []
          )
        );
        if (!isCurrent()) return;

        for (const element of elements)
          element.setAttribute("data-ayme-highlight", "");
        highlightedElements.current = elements;
      } catch (error) {
        if (!isCurrent()) return;
        console.warn(
          `Could not highlight ${"path" in target ? target.path : target.ref}: ${errorMessage(error)}`
        );
      }
    },
    [clearHighlightedElements]
  );

  /** Hover or focus: highlight a target until the preview ends. */
  const preview = useCallback(
    (target: HighlightTarget) => {
      hoveredTarget.current = target;
      void applyHighlight(target);
    },
    [applyHighlight]
  );

  const clearPreview = useCallback(() => {
    hoveredTarget.current = undefined;
    void applyHighlight(pinnedTarget.current);
  }, [applyHighlight]);

  /** Click: pin a target, or unpin it when it is already pinned. */
  const togglePinned = useCallback(
    (target: HighlightTarget) => {
      const next = sameTarget(pinnedTarget.current, target)
        ? undefined
        : target;
      pinnedTarget.current = next;
      setPinned(next);
      void applyHighlight(hoveredTarget.current ?? next);
    },
    [applyHighlight]
  );

  /** A Page Object or member, by registry path. */
  const previewTarget = useCallback(
    (path: string) => preview({ path }),
    [preview]
  );
  const togglePinnedTarget = useCallback(
    (path: string) => togglePinned({ path }),
    [togglePinned]
  );
  /** A node of the page's structure, by ref. */
  const previewRef = useCallback((ref: string) => preview({ ref }), [preview]);
  const togglePinnedRef = useCallback(
    (ref: string) => togglePinned({ ref }),
    [togglePinned]
  );

  useEffect(() => {
    mounted.current = true;
    let refreshTimer: ReturnType<typeof setTimeout> | undefined;

    // The page re-renders under a pinned highlight; re-resolve it so the
    // highlight follows the target's current element.
    const observer = new MutationObserver((records) => {
      if (records.every(isInspectorOwnMutation)) return;
      if (
        !pinnedTarget.current ||
        hoveredTarget.current ||
        refreshTimer !== undefined
      )
        return;
      refreshTimer = setTimeout(() => {
        refreshTimer = undefined;
        if (pinnedTarget.current) void applyHighlight(pinnedTarget.current);
      }, 40);
    });
    observer.observe(document.body, {
      attributes: true,
      childList: true,
      characterData: true,
      subtree: true,
    });

    const updateRegistry = () => {
      setRegistry(readRegistry());
      void refreshPageState();
    };
    updateRegistry();
    const unsubscribe = subscribeToRegisteredPoms(updateRegistry);

    return () => {
      mounted.current = false;
      observer.disconnect();
      if (refreshTimer !== undefined) clearTimeout(refreshTimer);
      clearHighlightedElements();
      unsubscribe();
    };
  }, [applyHighlight, clearHighlightedElements, refreshPageState]);

  return {
    ...registry,
    pageState,
    refreshPageState,
    pinnedPath: pinned && "path" in pinned ? pinned.path : undefined,
    pinnedRef: pinned && "ref" in pinned ? pinned.ref : undefined,
    previewTarget,
    previewRef,
    clearPreview,
    togglePinnedTarget,
    togglePinnedRef,
  };
}

/** What the page highlights: a registry path, or a node of the structure. */
type HighlightTarget = { path: string } | { ref: string };

function sameTarget(a: HighlightTarget | undefined, b: HighlightTarget) {
  return a !== undefined && JSON.stringify(a) === JSON.stringify(b);
}

/** Resolves a highlight target to the page state nodes it addresses now. */
async function resolveHighlightTarget(
  target: HighlightTarget,
  /** The page state the Inspector captured last; resolving recaptures. */
  latest: PageState | undefined
) {
  if ("ref" in target) {
    const state = latest ?? (await getPageStateForElements([])).state;
    return state.resolve(target.ref as AriaRef);
  }
  const targets = (await listRegisteredPomTargets()).filter(
    (candidate) => candidate.path === target.path
  );
  const { state, refs } = await getPageStateForElements(
    uniqueElements(targets.map((candidate) => candidate.element))
  );
  return state.resolve(
    ...refs.filter((ref): ref is AriaRef => ref !== undefined)
  );
}

/**
 * Captures the page state an agent receives, with the refs agents use, and
 * maps each ref to the Page Object member whose element it is.
 */
async function captureStructure() {
  const targets = await listRegisteredPomTargets();
  const elements = uniqueElements(targets.map((target) => target.element));
  const { state, refs } = await getPageStateForElements(elements);
  // The first path the registry lists for an element is its own member;
  // the rest are aliases through parents and classes.
  const memberByElement = new Map<Element, MemberMapping>();
  for (const { element, path } of targets)
    if (!memberByElement.has(element))
      memberByElement.set(element, memberOfTarget(path));
  const membersByRef = new Map<string, MemberMapping>();
  elements.forEach((element, index) => {
    const ref = refs[index];
    const member = memberByElement.get(element);
    if (ref !== undefined && member !== undefined)
      membersByRef.set(ref, member);
  });
  return {
    state,
    structure: buildStructureTree(state.text, membersByRef),
  };
}

function isInspectorOwnMutation(record: MutationRecord) {
  return (
    (record.type === "attributes" &&
      record.attributeName === "data-ayme-highlight") ||
    (record.target instanceof Element &&
      record.target.matches("[data-ayme-inspector-host]"))
  );
}

function uniqueElements(elements: readonly Element[]) {
  return [...new Set(elements)];
}

export function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
