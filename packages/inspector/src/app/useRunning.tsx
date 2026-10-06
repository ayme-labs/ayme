import { useState } from "react";

import { type MemberIndex, pathBelowPage } from "../page-model";
import { type StructureNode, structureRows } from "../structure";
import { type CollectionItem, type RunFocus, Runs, runScope } from "../runs";
import type { InspectorRuntime } from "./useInspectorRuntime";
import type { ViewState } from "./viewState";
import { RunsRegion } from "../panel";
import type { RenderRun, Selection } from "../navigation";
import { findRefNode, RunCard } from "../tools";

/**
 * Running from the panel: the run slot's run card, and Runs scoped to the
 * selection. A run card's last-success link shows that run in Runs. Whether
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

  const showRun = (runId: number) => {
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
