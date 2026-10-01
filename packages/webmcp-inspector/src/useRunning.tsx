import { useState } from "react";

import { collectionItems, type StructureNode } from "./adapter/structure";
import type { CollectionItem } from "./adapter/useRuns";
import type { InspectorRuntime } from "./adapter/useRuntimeAdapter";
import { RunsRegion } from "./frame/InspectorBody";
import type { RenderRun } from "./frame/runSlot";
import type { Selection } from "./frame/selection";
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
  const scope = runScope(
    selection,
    (ref) => findNode(roots, ref)?.members ?? []
  );
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
      ? itemsOf(tool.collection, pageState.structure)
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
          pickPrompt: refPicking.promptOf(toolName),
          onPreview: (ref) => highlight.hover({ ref }),
          onPreviewEnd: () => highlight.hover(undefined),
        }}
        runs={runs.filter((run) => run.toolName === toolName)}
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

/**
 * A collection action's items on the page, labelled by what they show.
 *
 * @param collection where the items are, e.g. "ListPage.items[]" or, inside
 *   a collection, "ListPage.items[].tags[]".
 */
function itemsOf(
  collection: string,
  structure: InspectorRuntime["pageState"]["structure"]
): CollectionItem[] {
  return collectionItems(structure, collection).map(({ path, ref }) => ({
    path,
    ref,
    label: textOf(findNode(structure.roots, ref)),
  }));
}

/** What a node shows: its name, or else its first text. */
function textOf(node: StructureNode | undefined): string {
  if (!node) return "";
  if (node.name) return node.name;
  for (const child of node.children) {
    const text = textOf(child);
    if (text) return text;
  }
  return "";
}
