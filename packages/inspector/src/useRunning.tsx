import { useState } from "react";

import { pathBelowPage, type MemberIndex } from "./adapter/memberIndex";
import { structureRows, type StructureNode } from "./adapter/structure";
import type { CollectionItem } from "./adapter/useRuns";
import type { InspectorRuntime } from "./adapter/useRuntimeAdapter";
import { RunsRegion } from "./panel/view/InspectorBody";
import type { RenderRun } from "./navigation/domain/runSlot";
import type { Selection } from "./navigation/domain/selection";
import { RunCard } from "./runCard/RunCard";
import { Runs, type RunFocus } from "./runs/Runs";
import { runScope } from "./runs/runScope";

/**
 * Running from the panel: the run slot's run card, and Runs scoped to the
 * selection. A run card's last-success link shows that run in Runs.
 */
export function useRunning(runtime: InspectorRuntime, selection: Selection) {
  const { runs, runnableTools, pageState, highlight, refPicking, members } =
    runtime;
  const [allRuns, setAllRuns] = useState(false);
  const [open, setOpen] = useState(true);
  const [focus, setFocus] = useState<RunFocus>();

  const roots = pageState.structure.roots;
  const scope = runScope(
    selection,
    (ref) => findNode(roots, ref)?.members ?? [],
    (path) => members.within(path, { models: false })
  );
  const shownRuns = allRuns ? runs : runs.filter(scope.includes);

  const showRun = (runId: number) => {
    setOpen(true);
    if (!shownRuns.some((run) => run.id === runId)) setAllRuns(true);
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
 * A collection action's items on the page, by its tool's name, in page
 * order, labelled by what they show. An item with no ref in the page state
 * is left out.
 */
function itemsOf(
  toolName: string,
  members: MemberIndex,
  structure: InspectorRuntime["pageState"]["structure"]
): CollectionItem[] {
  const rows = [...structureRows(structure.roots)];
  return members.collectionItems(toolName).flatMap((item) => {
    const node = rows.find(
      ({ node }) => node.ref !== undefined && node.members.includes(item.path)
    )?.node;
    return node?.ref === undefined
      ? []
      : [
          {
            path: item.path,
            name: item.name,
            pathBelowPage: pathBelowPage(item, members),
            ref: node.ref,
            label: textOf(node),
          },
        ];
  });
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
