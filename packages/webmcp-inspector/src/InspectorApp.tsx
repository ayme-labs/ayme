import { useEffect, useState } from "react";

import { useRuntimeAdapter } from "./adapter/useRuntimeAdapter";
import { Empty } from "./common";
import { DetailPane, InspectorBody } from "./frame/InspectorBody";
import { selectionHighlight } from "./frame/highlight";
import type { Lens, LensId } from "./frame/lens";
import { memberResolves } from "./frame/memberSelection";
import { Navigator } from "./frame/Navigator";
import { pageSelection, type Selection } from "./frame/selection";
import { InspectorRoot } from "./InspectorRoot";
import { modelLens } from "./lenses/modelLens";
import { structureLens } from "./lenses/structureLens";
import { toolsLens } from "./lenses/toolsLens";
import { InspectorShell } from "./shell/InspectorShell";
import { usePreferences } from "./shell/usePreferences";
import { useDarkTheme } from "./shell/useTheme";
import { WebMcpStatus } from "./shell/WebMcpStatus";
import { useRunning } from "./useRunning";

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
  const { renderRun, runsRegion } = useRunning(runtime, selection);

  const lenses: Lens[] = [
    modelLens({
      host: window.location.host,
      pageModel: runtime.pageModel,
      pageTools: runtime.tools.live
        .filter((tool) => tool.group === "agent")
        .map((tool) => tool.name),
      panes: preferences.modelPanes,
      onPanesChange: (modelPanes) => updatePreferences({ modelPanes }),
      selection,
      onSelect: setSelection,
      onHover: runtime.highlight.hover,
      renderRun,
    }),
    structureLens({
      structure: runtime.pageState.structure,
      pageState: runtime.pageState,
      onRefresh: runtime.refreshPageState,
    }),
    toolsLens({
      tools: [...runtime.runnableTools.values()].map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.argumentsSchema,
        available: tool.available,
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
          runs={runsRegion}
        />
      </InspectorShell>
    </InspectorRoot>
  );
}

/** The selection's solid highlight: its lens's, or the frame's default. */
function pinTarget(lenses: readonly Lens[], selection: Selection) {
  for (const lens of lenses) {
    const target = lens.selectionHighlight?.(selection);
    if (target) return target;
  }
  return selectionHighlight(selection);
}
