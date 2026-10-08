import { useState } from "react";

import { itemsOf } from "./collectionItems";
import { isPanelRun, type RunFocus, Runs, runScope } from "../runs";
import type { InspectorRuntime } from "./useInspectorRuntime";
import type { ViewState } from "./viewState";
import { RunsRegion } from "../panel";
import type { RenderRun, Selection } from "../navigation";
import { argumentViolationsOf, findRefNode, RunCard } from "../tools";

/**
 * Running from the panel: the run slot's run card, and Runs scoped to the
 * selection. A run card shows the panel's own runs of its tool; its
 * last-success link shows that run in Runs. Whether
 * Runs is open and lists every run is part of the view state.
 */
export function useRunning(
  runtime: InspectorRuntime,
  selection: Selection,
  {
    view: { open, all: allRuns },
    onViewChange,
  }: {
    view: ViewState["runs"];
    onViewChange: (view: ViewState["runs"]) => void;
  }
) {
  const { runs, runnableTools, pageState, highlight, refPicking, members } =
    runtime;
  const setAllRuns = (all: boolean) => onViewChange({ open, all });
  const setOpen = (open: boolean) => onViewChange({ open, all: allRuns });
  const [focus, setFocus] = useState<RunFocus>();

  const roots = pageState.structure.roots;
  const scope = runScope(
    selection,
    (ref) => findRefNode(roots, ref)?.members ?? [],
    (path) => members.within(path, { models: false })
  );
  const shownRuns = allRuns ? runs : runs.filter(scope.includes);

  const showRun = (runId: string) => {
    onViewChange({
      open: true,
      all: allRuns || !shownRuns.some((run) => run.id === runId),
    });
    setFocus({ runId, at: Date.now() });
  };

  const renderRun: RenderRun = ({ toolName, item, ref, head }) => {
    const tool = runnableTools.get(toolName);
    if (!tool) return null;
    const items = tool.collection
      ? itemsOf(toolName, members, pageState.structure)
      : [];
    return (
      <RunCard
        key={`${toolName}|${item ?? ""}|${ref ?? ""}`}
        tool={tool}
        available={tool.available}
        head={head}
        item={items.find((candidate) => candidate.path === item)}
        items={items}
        structuralRef={ref}
        refSource={{
          roots,
          canUse: refPicking.canUse(toolName),
          onPick: refPicking.start,
          pickPrompt: refPicking.promptOf(toolName),
          onPreview: (ref) => highlight.hover({ ref }),
          onPreviewEnd: () => highlight.hover(undefined),
        }}
        runs={runs.filter(
          (run) => run.toolName === toolName && isPanelRun(run)
        )}
        argumentViolations={argumentViolationsOf(tool)}
        onRun={(input, target) => runtime.runTool(toolName, input, target)}
        onShowRun={showRun}
        onHover={highlight.hover}
      />
    );
  };

  const runsRegion = (
    <RunsRegion collapsed={!open}>
      <Runs
        runs={shownRuns}
        scopeLabel={scope.label}
        allRuns={allRuns}
        onAllRunsChange={setAllRuns}
        open={open}
        onOpenChange={setOpen}
        onClear={runtime.clearRuns}
        focus={focus}
        onHover={highlight.hover}
      />
    </RunsRegion>
  );

  return { renderRun, runsRegion };
}
