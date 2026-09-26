import {
  walk,
  type PageModel,
  type PageObjectNode,
} from "../adapter/pageModel";
import { Empty } from "../common";
import type { Lens, SearchEntry } from "../frame/lens";
import type { RenderRun } from "../frame/runSlot";
import type { Selection } from "../frame/selection";
import { highlighting, type HighlightControls } from "./model/highlight";
import { ModelDetail, ObjectDetail, PageDetail } from "./model/ModelDetails";
import { ModelTree } from "./model/ModelTree";

export type { HighlightControls } from "./model/highlight";

/**
 * The Model lens: the Page Objects on the page as a tree, and the Page
 * Object Models the page knows. It owns the page, object and model
 * selections. Picking an object pins its highlight on the page; picking
 * anything else in the lens unpins it.
 */
export function modelLens({
  host,
  pageModel,
  selection,
  onSelect,
  highlight: controls,
  renderRun,
}: {
  /** The page's host, e.g. localhost:5173. */
  host: string;
  pageModel: PageModel;
  selection: Selection;
  onSelect: (selection: Selection) => void;
  highlight: HighlightControls;
  renderRun: RenderRun;
}): Lens {
  const highlight = highlighting(controls);
  const nodes = [...walk(pageModel.objects)];
  const byPath = new Map(nodes.map((node) => [node.path, node]));
  const objects = nodes.filter((node) => node.kind !== "collection");
  const live = objects.filter((node) => node.live).length;

  const selectPage = () => {
    onSelect({ kind: "page" });
    highlight.pin(undefined);
  };
  const selectObject = (node: PageObjectNode) => {
    onSelect({ kind: "object", path: node.path });
    highlight.pin(node.live ? node.highlightPath : undefined);
  };
  const selectModel = (className: string) => {
    onSelect({ kind: "model", className });
    highlight.pin(undefined);
  };

  return {
    id: "model",
    label: "Model",
    tree: (
      <ModelTree
        host={host}
        objects={pageModel.objects}
        models={pageModel.models}
        liveCount={live}
        selection={selection}
        highlight={highlight}
        onPickPage={selectPage}
        onPickObject={selectObject}
        onPickModel={selectModel}
      />
    ),
    searchEntries: searchEntries(pageModel, nodes),
    legend: { live, notOnPage: objects.length - live },
    detail: (selected) => {
      if (selected.kind === "page")
        return (
          <PageDetail
            host={host}
            pages={pageModel.objects}
            modelCount={pageModel.models.length}
            highlight={highlight}
            onOpenObject={selectObject}
          />
        );
      if (selected.kind === "object") {
        const node = byPath.get(selected.path);
        if (!node)
          return <Empty>{selected.path} is no longer on the page.</Empty>;
        return (
          <ObjectDetail
            node={node}
            highlight={highlight}
            renderRun={renderRun}
            onOpenModel={selectModel}
            onOpenObject={(path) => {
              const child = byPath.get(path);
              if (child) selectObject(child);
            }}
          />
        );
      }
      if (selected.kind === "model") {
        const model = pageModel.models.find(
          (candidate) => candidate.className === selected.className
        );
        if (!model)
          return <Empty>The page no longer knows {selected.className}.</Empty>;
        return (
          <ModelDetail
            model={model}
            instances={model.instancePaths.flatMap(
              (path) => byPath.get(path) ?? []
            )}
            highlight={highlight}
            renderRun={renderRun}
            onOpenModel={selectModel}
            onOpenObject={selectObject}
          />
        );
      }
      return undefined;
    },
  };
}

function searchEntries(
  pageModel: PageModel,
  nodes: readonly PageObjectNode[]
): SearchEntry[] {
  const objectEntries = nodes.map((node): SearchEntry => ({
    key: `object:${node.path}`,
    kind: "Object",
    label: node.path,
    description:
      node.kind === "collection"
        ? `${node.className}[] · ${node.itemCount ?? 0} items`
        : `${node.className} · ${node.live ? "Live" : "Not on page"}`,
    selection: { kind: "object", path: node.path },
    ...(node.live && node.highlightPath
      ? { highlightPath: node.highlightPath }
      : {}),
  }));
  const modelEntries = pageModel.models.flatMap((model): SearchEntry[] => {
    const onPage = model.instancePaths.length;
    const selection: Selection = { kind: "model", className: model.className };
    return [
      {
        key: `model:${model.className}`,
        kind: "POM",
        label: model.className,
        description: `Page object · ${onPage ? `${onPage} on page` : "not on page"}`,
        selection,
      },
      ...model.actions.map((action) => ({
        key: `action:${model.className}.${action.name}`,
        kind: "Action",
        label: `${model.className}.${action.name}`,
        description: [
          action.description,
          !action.publishedToolNames.length && "Not published.",
        ]
          .filter(Boolean)
          .join(" "),
        selection,
      })),
      ...model.members.map((member) => ({
        key: `member:${model.className}.${member.name}`,
        kind: "Member",
        label: `${model.className}.${member.name}`,
        description:
          member.kind === "locator"
            ? "locator"
            : `${member.className}${member.collection ? "[]" : ""}`,
        selection,
        ...(onPage && member.highlightPath
          ? { highlightPath: member.highlightPath }
          : {}),
      })),
    ];
  });
  return [...objectEntries, ...modelEntries];
}
