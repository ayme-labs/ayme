import { useCallback, useEffect, useMemo, useState } from "react";

import {
  useRuntimeAdapter,
  type InspectorRuntime,
} from "./adapter/useRuntimeAdapter";
import type { Run } from "./adapter/useRuns";
import { Empty } from "./common";
import { DetailPane, InspectorBody, RunsRegion } from "./frame/InspectorBody";
import { selectionHighlight, type OnHover } from "./frame/highlight";
import type { Lens, LensId } from "./frame/lens";
import { memberResolves } from "./frame/memberSelection";
import { Navigator } from "./frame/Navigator";
import type { RenderRun } from "./frame/runSlot";
import { pageSelection, type Selection } from "./frame/selection";
import { InspectorRoot } from "./InspectorRoot";
import { modelLens } from "./lenses/modelLens";
import { structureLens } from "./lenses/structureLens";
import { toolsLens } from "./lenses/toolsLens";
import { RunsTab } from "./RunsTab";
import { InspectorShell } from "./shell/InspectorShell";
import { usePreferences } from "./shell/usePreferences";
import { useDarkTheme } from "./shell/useTheme";
import { WebMcpStatus } from "./shell/WebMcpStatus";
import type { FieldValue, FieldValues } from "./toolArguments";
import { ToolForm } from "./ToolForm";

/**
 * The Inspector: the runtime adapter's data wired into the frame. It owns
 * the one selection the navigator, the detail pane and Runs share.
 */
export function InspectorApp() {
  const [preferences, updatePreferences] = usePreferences();
  const [activeLens, setActiveLens] = useState<LensId>("model");
  const runtime = useRuntimeAdapter({
    structureVisible: activeLens === "structure" && !preferences.collapsed,
  });
  const dark = useDarkTheme(preferences.theme);
  const [selection, setSelection] = useState<Selection>(pageSelection);
  const renderRun = useSkeletonRunSlot(runtime);

  const lenses: Lens[] = [
    modelLens({
      host: window.location.host,
      pomClasses: runtime.pomClasses,
      selection,
      onSelect: setSelection,
      highlight: skeletonHighlight(runtime.highlight.hover),
      renderRun,
    }),
    structureLens({
      structure: runtime.pageState.structure,
      pageState: runtime.pageState,
      onRefresh: runtime.refreshPageState,
    }),
    toolsLens({
      tools: [...runtime.registeredTools.values()].map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
        available: runtime.activeTools.has(tool.name),
      })),
      selection,
      onSelect: setSelection,
      renderRun,
    }),
  ];
  // One pin, and it is the selection: the solid highlight follows it.
  const pinKey = JSON.stringify(pinTarget(lenses, selection) ?? null);
  const { pin } = runtime.highlight;
  useEffect(() => pin(JSON.parse(pinKey) ?? undefined), [pin, pinKey]);

  // A member selection whose path no longer resolves is stale: back to the
  // page. Only judged once the page state has been read.
  const { structure, capturedAt } = runtime.pageState;
  const staleMember =
    selection.kind === "member" &&
    capturedAt !== undefined &&
    !memberResolves(structure, selection.path);
  useEffect(() => {
    if (staleMember) setSelection(pageSelection);
  }, [staleMember]);

  const detail = lenses
    .map((lens) => lens.detail(selection))
    .find((view) => view !== undefined) ?? (
    <Empty>Nothing to show for this selection.</Empty>
  );

  return (
    <InspectorRoot dark={dark}>
      <InspectorShell
        preferences={preferences}
        onPreferencesChange={updatePreferences}
        pageName={runtime.pageName}
      >
        <WebMcpStatus status={runtime.tools.publication} />
        <InspectorBody
          layout={preferences.layout}
          navigator={
            <Navigator
              lenses={lenses}
              activeLens={activeLens}
              onLensChange={setActiveLens}
              onSelect={setSelection}
              onHover={runtime.highlight.hover}
            />
          }
          detail={<DetailPane>{detail}</DetailPane>}
          runs={
            <RunsRegion>
              <RunsTab
                runs={runtime.runs}
                clearRuns={runtime.clearRuns}
                trace={runtime.trace}
              />
            </RunsRegion>
          }
        />
      </InspectorShell>
    </InspectorRoot>
  );
}

/**
 * The skeleton's run slot: the typed tool form. Ticket D replaces it with
 * the run card.
 */
function useSkeletonRunSlot(runtime: InspectorRuntime): RenderRun {
  const { registeredTools, activeTools, runs, runTool } = runtime;
  const [formValues, setFormValues] = useState<Record<string, FieldValues>>({});
  const setFieldValue = useCallback(
    (toolName: string, parameterName: string, value: FieldValue) =>
      setFormValues((current) => ({
        ...current,
        [toolName]: { ...current[toolName], [parameterName]: value },
      })),
    []
  );
  const lastRunByTool = useMemo(() => {
    const lastRuns = new Map<string, Run>();
    for (const run of runs)
      if (!lastRuns.has(run.toolName)) lastRuns.set(run.toolName, run);
    return lastRuns;
  }, [runs]);

  return ({ toolName }) => {
    const tool = registeredTools.get(toolName);
    if (!tool) return null;
    return (
      <ToolForm
        key={toolName}
        tool={tool}
        available={activeTools.has(toolName)}
        values={formValues[toolName]}
        onChange={(parameterName, value) =>
          setFieldValue(toolName, parameterName, value)
        }
        onInvoke={(args) => runTool(toolName, args)}
        lastRun={lastRunByTool.get(toolName)}
      />
    );
  };
}

/** The selection's solid highlight: its lens's, or the frame's default. */
function pinTarget(lenses: readonly Lens[], selection: Selection) {
  for (const lens of lenses) {
    const target = lens.selectionHighlight?.(selection);
    if (target) return target;
  }
  return selectionHighlight(selection);
}

/**
 * The skeleton Page objects view's highlight controls: its members hover.
 * Ticket E replaces the view; its pin toggle does nothing, since the pin is
 * the selection now.
 */
function skeletonHighlight(hover: OnHover) {
  return {
    pinnedPath: undefined,
    previewTarget: (path: string) => hover({ path }),
    clearPreview: () => hover(undefined),
    togglePinnedTarget: () => {},
  };
}
