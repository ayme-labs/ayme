import { useEffect, useMemo, useState } from "react";

import { useInspectorRuntime } from "./useInspectorRuntime";
import { Empty } from "../shared/view";
import {
  inspectorClient,
  useInspectorState,
  useTabState,
} from "../shared/infrastructure";
import { InspectorRoot, useCopy } from "../shared/presentation";
import { Connections, DetailPane } from "../panel/view";
import {
  InspectorBody,
  InspectorShell,
  useDarkTheme,
  WindowShell,
} from "../panel/presentation";
import { useHostReservation, usePreferences } from "../panel/infrastructure";
import { type WindowFullscreen } from "../panel/domain";
import {
  type Lens,
  type LensId,
  pageSelection,
  type Selection,
  selectionHighlight,
} from "../navigation/domain";
import { Navigator } from "../navigation/presentation";
import { isStaleSelection } from "../structure/application";
import { structureLens } from "../structure/presentation";
import { unfoldedOnPage } from "../structure/domain";
import { modelLens } from "../page-model/presentation";
import { toolsLens } from "../tools/presentation";
import { useRunning } from "./useRunning";
import { decodeViewState, viewStateKey, withSelection } from "./viewState";

/**
 * The Inspector: the runtime's data wired into the panel. It owns
 * the one selection the navigator, the detail pane and Runs share, and
 * keeps where the person was in it for the tab. `windowed` fills a window of
 * the Inspector's own, outside the page it shows, in place of the dockable
 * panel; `fullscreen` is what an Agent App that shows that window offers.
 * `session` says a Session serves the window, which no agent reaches
 * through the Agent Connection or WebMCP, so the header leaves out the
 * Connections pill that tells of them.
 */
export function InspectorApp({
  windowed = false,
  fullscreen,
  session = false,
}: {
  windowed?: boolean;
  fullscreen?: WindowFullscreen;
  session?: boolean;
}) {
  const [preferences, updatePreferences] = usePreferences();
  const reserveHost = useHostReservation();
  const [viewState, setViewState] = useTabState(viewStateKey, decodeViewState);
  const { lens: activeLens, selection } = viewState;
  const setActiveLens = (lens: LensId) =>
    setViewState((current) => ({ ...current, lens }));
  const setSelection = (selection: Selection) =>
    setViewState((current) => withSelection(current, selection));
  // Like a node selection, unfolded chains name refs, so a reload drops them.
  const [unfoldedChains, setUnfoldedChains] = useState<ReadonlySet<string>>(
    () => new Set()
  );
  const { copied, copy } = useCopy();
  // A window that has heard nothing from a page has no page serving the
  // contract: none is paired, or its session is inline.
  const client = inspectorClient();
  const heardNothing = useInspectorState(client).revision === 0;
  const unserved = windowed && client.external && heardNothing;
  const runtime = useInspectorRuntime({
    structureVisible:
      activeLens === "structure" && (windowed || !preferences.collapsed),
  });
  const dark = useDarkTheme(preferences.theme);
  const { renderRun, runsRegion } = useRunning(runtime, selection, {
    view: viewState.runs,
    onViewChange: (runs) => setViewState((current) => ({ ...current, runs })),
  });
  const { live, appProcess } = runtime.tools;
  const tools = useMemo(() => [...live, ...appProcess], [live, appProcess]);

  const lenses: Lens[] = [
    modelLens({
      // A window of its own is not on the page it shows, and does not know
      // its host.
      host: windowed ? "page" : window.location.host,
      pageModel: runtime.pageModel,
      pageTools: live
        .filter((tool) => tool.group === "agent")
        .map((tool) => tool.name),
      panes: preferences.modelPanes,
      onPanesChange: (modelPanes) => updatePreferences({ modelPanes }),
      objectTree: viewState.objectTree,
      onObjectTreeChange: (objectTree) =>
        setViewState((current) => ({ ...current, objectTree })),
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
      unfoldedChains,
      onUnfoldedChainsChange: setUnfoldedChains,
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
  // page; the effect makes it the selection. A selection restored after a
  // reload waits for the first look at the page, until what it names is
  // there.
  const pageStateRead = runtime.pageState.capturedAt !== undefined;
  // Unfolded chains whose outermost wrapper left the page are forgotten,
  // once the page has been read.
  const { structure } = runtime.pageState;
  useEffect(() => {
    if (pageStateRead)
      setUnfoldedChains((current) => unfoldedOnPage(current, structure.roots));
  }, [pageStateRead, structure]);
  const stale = isStaleSelection(selection, {
    hasView: view !== undefined,
    structure: runtime.pageState.structure,
    pageStateRead,
    within: (path) => runtime.members.within(path),
  });
  useEffect(() => {
    if (stale && pageStateRead)
      setViewState((current) => ({ ...current, selection: pageSelection }));
  }, [stale, pageStateRead, setViewState]);
  const detail = unserved ? (
    <Empty>
      No page is serving the Inspector. Pair a page with this ayme mcp, and
      start that page&apos;s ayme session with{" "}
      <code>
        inspector: {"{"} placement: &quot;external&quot; {"}"}
      </code>
      .
    </Empty>
  ) : (
    ((stale ? viewOf(pageSelection) : view) ?? (
      <Empty>Nothing to show for this selection.</Empty>
    ))
  );

  const status = session ? undefined : (
    <Connections
      agent={runtime.tools.agentConnection}
      webMCP={runtime.tools.publication}
      tools={live}
      onCopy={copy}
      copied={copied}
    />
  );
  const inspectorBody = (
    <InspectorBody
      layout={windowed ? "bottom" : preferences.layout}
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
      regions={preferences.regions}
      onRegionsChange={(regions) => updatePreferences({ regions })}
    />
  );

  return (
    <InspectorRoot dark={dark}>
      {windowed ? (
        <WindowShell
          theme={preferences.theme}
          onThemeChange={(theme) => updatePreferences({ theme })}
          status={status}
          fullscreen={fullscreen}
        >
          {inspectorBody}
        </WindowShell>
      ) : (
        <InspectorShell
          preferences={preferences}
          onPreferencesChange={updatePreferences}
          reserveHost={reserveHost}
          status={status}
        >
          {inspectorBody}
        </InspectorShell>
      )}
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
