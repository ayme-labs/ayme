import { useCallback, useEffect, useRef, useState } from "react";

import type { AriaRef, RegisteredPomTool } from "@ayme-dev/webmcp";
import type { RegisteredPom } from "@ayme-dev/webmcp/internal";
import {
  capturePageState,
  getPageStateForElements,
  listRegisteredPomTargets,
  listRegisteredPomTools,
  listRegisteredPoms,
  subscribeToRegisteredPoms,
} from "@ayme-dev/webmcp/internal";

export type RegistrySnapshot = {
  registeredPoms: readonly RegisteredPom[];
  /** The tools callable now, by name: the ones WebMCP publishes. */
  activeTools: ReadonlyMap<string, RegisteredPomTool>;
};

export type PageStateView = {
  text?: string;
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
    loading: false,
  });
  const [pinnedPath, setPinnedPath] = useState<string>();

  const mounted = useRef(false);
  const pageStateRequestId = useRef(0);
  const highlightRequestId = useRef(0);
  const highlightedElements = useRef<Element[]>([]);
  const pinnedPathRef = useRef<string>(undefined);
  const hoveredPath = useRef<string>(undefined);

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
      const text = await capturePageState(document.body);
      if (!isCurrent()) return;
      setPageState({
        text,
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
    async (path: string | undefined) => {
      const requestId = ++highlightRequestId.current;
      const isCurrent = () =>
        mounted.current && requestId === highlightRequestId.current;
      clearHighlightedElements();
      if (!path) return;

      try {
        const targets = (await listRegisteredPomTargets()).filter(
          (target) => target.path === path
        );
        const { state, refs } = await getPageStateForElements(
          uniqueElements(targets.map((target) => target.element))
        );
        const resolutions = await state.resolve(
          ...refs.filter((ref): ref is AriaRef => ref !== undefined)
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
        console.warn(`Could not highlight ${path}: ${errorMessage(error)}`);
      }
    },
    [clearHighlightedElements]
  );

  /** Hover or focus: highlight a target until the preview ends. */
  const previewTarget = useCallback(
    (path: string) => {
      hoveredPath.current = path;
      void applyHighlight(path);
    },
    [applyHighlight]
  );

  const clearPreview = useCallback(() => {
    hoveredPath.current = undefined;
    void applyHighlight(pinnedPathRef.current);
  }, [applyHighlight]);

  /** Click: pin a target, or unpin it when it is already pinned. */
  const togglePinnedTarget = useCallback(
    (path: string) => {
      const next = pinnedPathRef.current === path ? undefined : path;
      pinnedPathRef.current = next;
      setPinnedPath(next);
      void applyHighlight(hoveredPath.current ?? next);
    },
    [applyHighlight]
  );

  useEffect(() => {
    mounted.current = true;
    let refreshTimer: ReturnType<typeof setTimeout> | undefined;

    // The page re-renders under a pinned highlight; re-resolve it so the
    // highlight follows the target's current element.
    const observer = new MutationObserver((records) => {
      if (records.every(isInspectorOwnMutation)) return;
      if (
        !pinnedPathRef.current ||
        hoveredPath.current ||
        refreshTimer !== undefined
      )
        return;
      refreshTimer = setTimeout(() => {
        refreshTimer = undefined;
        if (pinnedPathRef.current) void applyHighlight(pinnedPathRef.current);
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
    pinnedPath,
    previewTarget,
    clearPreview,
    togglePinnedTarget,
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
