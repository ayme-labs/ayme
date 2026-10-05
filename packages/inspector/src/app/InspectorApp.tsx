import { useEffect, useMemo, useState } from "react";

import { useInspectorRuntime } from "./useInspectorRuntime";
import { Empty, InspectorRoot } from "../shared";
import {
  DetailPane,
  InspectorBody,
  InspectorShell,
  useDarkTheme,
  useHostReservation,
  usePreferences,
  WebMcpStatus,
} from "../panel";
import {
  type Lens,
  type LensId,
  Navigator,
  pageSelection,
  type Selection,
  selectionHighlight,
} from "../navigation";
import { isStaleSelection, structureLens } from "../structure";
import { modelLens } from "../page-model";
import { attachToolModels, toolsLens } from "../tools";
import { useRunning } from "./useRunning";

/**
 * The Inspector: the runtime's data wired into the panel. It owns
 * the one selection the navigator, the detail pane and Runs share.
 */
export function InspectorApp() {
  const [preferences, updatePreferences] = usePreferences();
  const reserveHost = useHostReservation();
  const [activeLens, setActiveLens] = useState<LensId>("model");
  const runtime = useInspectorRuntime({
    structureVisible: activeLens === "structure" && !preferences.collapsed,
  });
  const dark = useDarkTheme(preferences.theme);
  const [selection, setSelection] = useState<Selection>(pageSelection);
  const { renderRun, runsRegion } = useRunning(runtime, selection);
  const { live } = runtime.tools;
  const tools = useMemo(
    () =>
      attachToolModels(
        live,
        runtime.pageModel.models.map((model) => ({
          className: model.className,
          tools: model.actions.flatMap((action) =>
            action.toolNames.map((name) => ({ name }))
          ),
        }))
      ),
    [live, runtime.pageModel]
  );

  const lenses: Lens[] = [
    modelLens({
      host: window.location.host,
      pageModel: runtime.pageModel,
      pageTools: live
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
      capture: runtime.pageState,
      selection,
      onSelect: setSelection,
      onHover: runtime.highlight.hover,
      elementTools: runtime.elementTools,
      renderRun,
    }),
    toolsLens({
      tools,
      definitionText: runtime.definitionText,
      selection,
      onSelect: setSelection,
      renderRun,
    }),
  ];
  // One pin, and it is the selection: the solid highlight follows it.
  const pinKey = JSON.stringify(pinTarget(lenses, selection) ?? null);
  const { pin } = runtime.highlight;
  useEffect(() => pin(JSON.parse(pinKey) ?? undefined), [pin, pinKey]);

  const viewOf = (selected: Selection) =>
    lenses
      .map((lens) => lens.detail(selected))
      .find((view) => view !== undefined);
  const view = viewOf(selection);
  // A stale selection goes back to the page. This render already shows the
  // page; the effect makes it the selection.
  const stale = isStaleSelection(selection, {
    hasView: view !== undefined,
    structure: runtime.pageState.structure,
    pageStateRead: runtime.pageState.capturedAt !== undefined,
    within: (path) => runtime.members.within(path),
  });
  useEffect(() => {
    if (stale) setSelection(pageSelection);
  }, [stale]);
  const detail = (stale ? viewOf(pageSelection) : view) ?? (
    <Empty>Nothing to show for this selection.</Empty>
  );

  return (
    <InspectorRoot dark={dark} glass={preferences.glass}>
      <InspectorShell
        preferences={preferences}
        onPreferencesChange={updatePreferences}
        reserveHost={reserveHost}
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

/** The selection's solid highlight: its lens's, or the default one. */
function pinTarget(lenses: readonly Lens[], selection: Selection) {
  for (const lens of lenses) {
    const target = lens.selectionHighlight?.(selection);
    if (target) return target;
  }
  return selectionHighlight(selection);
}
