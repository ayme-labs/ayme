import { useState } from "react";

import type { StructureNode } from "./adapter/structure";
import type { InspectorRuntime } from "./adapter/useRuntimeAdapter";
import { RunsRegion } from "./frame/InspectorBody";
import type { RenderRun } from "./frame/runSlot";
import type { Selection } from "./frame/selection";
import { collectionItems } from "./runCard/collectionItems";
import { RunCard } from "./runCard/RunCard";
import { Runs, type RunFocus } from "./runs/Runs";
import { runScope } from "./runs/runScope";

/**
 * Running from the panel: the run slot's run card, and Runs scoped to the
 * selection. A run card's last-success link shows that run in Runs.
 */
export function useRunning(runtime: InspectorRuntime, selection: Selection) {
  const { runs, runnableTools, pageState, highlight, refPicking } = runtime;
  const [allRuns, setAllRuns] = useState(false);
  const [open, setOpen] = useState(true);
  const [focus, setFocus] = useState<RunFocus>();

  const roots = pageState.structure.roots;
  const scope = runScope(selection, (ref) => findNode(roots, ref)?.member);
  const shownRuns = allRuns ? runs : runs.filter(scope.includes);

  const showRun = (runId: number) => {
    setOpen(true);
    if (!shownRuns.some((run) => run.id === runId)) setAllRuns(true);
    setFocus({ runId, at: Date.now() });
  };

  const renderRun: RenderRun = ({ toolName, item, head }) => {
    const tool = runnableTools.get(toolName);
    if (!tool) return null;
    const items = tool.collection
      ? collectionItems(tool.collection, roots)
      : [];
    return (
      <RunCard
        key={`${toolName}|${item ?? ""}`}
        tool={tool}
        available={tool.available}
        head={head}
        item={items.find((candidate) => candidate.path === item)}
        items={items}
        refSource={{
          roots,
          canUse: refPicking.canUse(toolName),
          onPick: refPicking.start,
          onPreview: (ref) => void refPicking.preview(ref),
          onPreviewEnd: refPicking.clearPreview,
        }}
        runs={runs.filter((run) => run.toolName === toolName)}
        onRun={(input, target) => runtime.runTool(toolName, input, target)}
        onShowRun={showRun}
        // A Page Object is highlighted by its root.
        onPreview={(path) => highlight.previewTarget(`${path}.root`)}
        onPreviewEnd={highlight.clearPreview}
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
        onPreviewStep={runtime.previewStep}
        onPreviewStepEnd={runtime.clearStepPreview}
      />
    </RunsRegion>
  );

  return { renderRun, runsRegion };
}

function findNode(
  nodes: readonly StructureNode[],
  ref: string
): StructureNode | undefined {
  for (const node of nodes) {
    if (node.ref === ref) return node;
    const found = findNode(node.children, ref);
    if (found) return found;
  }
}
