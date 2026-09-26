import { useState } from "react";

import { useRuntimeAdapter } from "./adapter/useRuntimeAdapter";
import { Empty } from "./common";
import { DetailPane, InspectorBody } from "./frame/InspectorBody";
import type { Lens, LensId } from "./frame/lens";
import { Navigator } from "./frame/Navigator";
import { pageSelection, type Selection } from "./frame/selection";
import { InspectorRoot } from "./InspectorRoot";
import { modelLens } from "./lenses/modelLens";
import { structureLens } from "./lenses/structureLens";
import { toolsLens } from "./lenses/toolsLens";
import { InspectorShell } from "./shell/InspectorShell";
import { usePreferences } from "./shell/usePreferences";
import { useDarkTheme } from "./shell/useTheme";
import { useRunning } from "./useRunning";

/**
 * The Inspector: the runtime adapter's data wired into the frame. It owns
 * the one selection the navigator, the detail pane and Runs share.
 */
export function InspectorApp() {
  const runtime = useRuntimeAdapter();
  const [preferences, updatePreferences] = usePreferences();
  const dark = useDarkTheme(preferences.theme);
  const [selection, setSelection] = useState<Selection>(pageSelection);
  const [activeLens, setActiveLens] = useState<LensId>("model");
  const { renderRun, runsRegion } = useRunning(runtime, selection);

  const lenses: Lens[] = [
    modelLens({
      host: window.location.host,
      pomClasses: runtime.pomClasses,
      selection,
      onSelect: setSelection,
      highlight: runtime.highlight,
      renderRun,
    }),
    structureLens({
      structure: runtime.pageState.structure,
      pageState: runtime.pageState,
      onRefresh: runtime.refreshPageState,
    }),
    toolsLens({
      tools: [
        ...[...runtime.registeredTools.values()].map((tool) => ({
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema,
          available: runtime.activeTools.has(tool.name),
        })),
        // Until G's lens lists every published tool: the built-in Ref tools.
        ...runtime.refTools,
      ],
      selection,
      onSelect: setSelection,
      renderRun,
    }),
  ];
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
        <InspectorBody
          layout={preferences.layout}
          navigator={
            <Navigator
              lenses={lenses}
              activeLens={activeLens}
              onLensChange={setActiveLens}
              onSelect={setSelection}
              onPreview={runtime.highlight.previewTarget}
              onPreviewEnd={runtime.highlight.clearPreview}
            />
          }
          detail={<DetailPane>{detail}</DetailPane>}
          runs={runsRegion}
        />
      </InspectorShell>
    </InspectorRoot>
  );
}
