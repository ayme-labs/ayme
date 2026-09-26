import { useCallback, useMemo } from "react";

import type { RegisteredPomTool } from "@ayme-dev/webmcp";
import { getPageContextTool } from "@ayme-dev/webmcp/internal";

import { listPomClasses } from "../pomModel";
import { listRunnableTools } from "./runnableTools";
import { clearStepPreview, previewStep } from "./runSteps";
import { useInspector } from "./useInspector";
import { useRuns } from "./useRuns";

/**
 * The runtime adapter: the one place the Inspector reads webmcp and runs
 * tools. Everything below it takes plain props, so a change to the runtime's
 * API only touches this folder.
 */
export function useRuntimeAdapter() {
  const inspector = useInspector();
  const { registeredPoms, refreshPageState } = inspector;
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
  const runnableTools = useMemo(
    () =>
      listRunnableTools(registeredPoms, inspector.activeTools, [
        getPageContextTool,
      ]),
    [registeredPoms, inspector.activeTools]
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
     * Every registered Page Object tool once by name, and the other tools the
     * panel can run, as the run card runs them.
     */
    runnableTools,
    /** The runs made from the panel, newest first. */
    runs,
    runTool: (...args: Parameters<typeof invoke>) => void invoke(...args),
    clearRuns: clear,
    /** Highlights a run step's element while it's on the page. */
    previewStep,
    clearStepPreview,
  };
}

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
