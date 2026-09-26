import { useCallback, useMemo } from "react";

import type { RegisteredPomTool } from "@ayme-dev/webmcp";

import { listPomClasses } from "../pomModel";
import { useInspector } from "./useInspector";
import { useInspectorTrace } from "./useInspectorTrace";
import { useRuns } from "./useRuns";

/**
 * The runtime adapter: the one place the Inspector reads webmcp and runs
 * tools. Everything below it takes plain props, so a change to the runtime's
 * API only touches this folder.
 */
export function useRuntimeAdapter() {
  const inspector = useInspector();
  const { registeredPoms, refreshPageState } = inspector;
  const trace = useInspectorTrace();
  const onRunSettled = useCallback(
    () => void refreshPageState(),
    [refreshPageState]
  );
  const { runs, invoke, clear } = useRuns({ onSettled: onRunSettled });

  const pomClasses = useMemo(
    () => listPomClasses(registeredPoms),
    [registeredPoms]
  );
  const registeredTools = useMemo(
    () => listRegisteredTools(registeredPoms),
    [registeredPoms]
  );

  return {
    /** The page's name for the header badge: its page Page Object's class. */
    pageName: registeredPoms[0]?.manifest.className,
    pomClasses,
    /** Every registered tool once by name, whether published now or not. */
    registeredTools,
    /** The tools published now, by name. */
    activeTools: inspector.activeTools,
    /** The page state, with the structure tree model. */
    pageState: inspector.pageState,
    refreshPageState: () => void refreshPageState(),
    highlight: {
      pinnedPath: inspector.pinnedPath,
      previewTarget: inspector.previewTarget,
      clearPreview: inspector.clearPreview,
      togglePinnedTarget: inspector.togglePinnedTarget,
    },
    /**
     * The published Ref tools. The runtime does not list them yet: the
     * internal entry's published tools (#181) will feed them.
     */
    refTools: noRefTools,
    /** Highlights a node of the page's structure, by ref. */
    refHighlight: {
      pinnedRef: inspector.pinnedRef,
      previewRef: inspector.previewRef,
      clearPreview: inspector.clearPreview,
      togglePinnedRef: inspector.togglePinnedRef,
    },
    runs,
    runTool: (toolName: string, args: Parameters<typeof invoke>[1]) =>
      void invoke(toolName, args),
    clearRuns: clear,
    trace,
  };
}

const noRefTools: readonly { name: string }[] = [];

export type InspectorRuntime = ReturnType<typeof useRuntimeAdapter>;

function listRegisteredTools(
  registeredPoms: ReturnType<typeof useInspector>["registeredPoms"]
) {
  const tools = new Map<string, RegisteredPomTool>();
  for (const registration of registeredPoms)
    for (const tool of registration.tools)
      if (!tools.has(tool.name)) tools.set(tool.name, tool);
  return tools as ReadonlyMap<string, RegisteredPomTool>;
}
