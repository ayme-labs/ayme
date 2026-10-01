import { useCallback, useMemo } from "react";

import type { RegisteredPomTool } from "@ayme-dev/webmcp";
import { getPomDefinitionText } from "@ayme-dev/webmcp/internal";

import { listPomClasses } from "../pomModel";
import { useLiveTools } from "./liveTools";
import { useInspector } from "./useInspector";
import { useInspectorTrace } from "./useInspectorTrace";
import { useRuns } from "./useRuns";

/**
 * The runtime adapter: the one place the Inspector reads webmcp and runs
 * tools. Everything below it takes plain props, so a change to the runtime's
 * API only touches this folder.
 */
export function useRuntimeAdapter({
  structureVisible = false,
}: {
  /** Whether the Structure view shows, so the page state is kept live. */
  structureVisible?: boolean;
} = {}) {
  const inspector = useInspector({ structureVisible });
  const { registeredPoms, refreshPageState } = inspector;
  const trace = useInspectorTrace();
  const onRunSettled = useCallback(
    () => refreshPageState(),
    [refreshPageState]
  );
  const { runs, invoke, clear } = useRuns({ onSettled: onRunSettled });
  const tools = useLiveTools();

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
    /**
     * The tools the panel can run now: `tools.live`, every live tool in
     * publication order, published or not;
     * and `tools.publication`, the WebMCP publication status (a failure
     * carries its error in `message`).
     */
    tools,
    /**
     * The POM definitions for `names` (every known one when none are given),
     * as `get_page_context` renders them. Captures no page state.
     */
    definitionText: (...names: string[]) => getPomDefinitionText(...names),
    /** Every registered tool once by name, whether published now or not. */
    registeredTools,
    /** The tools published now, by name. */
    activeTools: inspector.activeTools,
    /**
     * The page state as an agent would receive it, kept live without ever
     * being recorded: its text, the structure tree model, and the refs each
     * published Ref Tool can take (`pageState.refToolTargets`).
     */
    pageState: inspector.pageState,
    refreshPageState,
    /**
     * The page's two highlights: `hover` (dashed) for what the pointer is
     * over in the panel, `pin` (solid) for the selection. The app pins the
     * selection; lenses only hover.
     */
    highlight: inspector.highlight,
    runs,
    runTool: (toolName: string, args: Parameters<typeof invoke>[1]) =>
      void invoke(toolName, args),
    clearRuns: clear,
    trace,
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
