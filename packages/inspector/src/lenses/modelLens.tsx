import {
  walk,
  type PageModel,
  type PageObjectNode,
} from "../adapter/pageModel";
import { Empty } from "../shared/view/common";
import type { Lens, SearchEntry } from "../navigation/domain/lens";
import type { RenderRun } from "../navigation/domain/runSlot";
import type { Selection } from "../navigation/domain/selection";
import type { ModelPanes } from "../panel/domain/preferences";
import type { OnHover } from "../navigation/domain/highlight";
import {
  MemberDetail,
  ModelDetail,
  ObjectDetail,
  PageDetail,
  type MemberView,
} from "./model/ModelDetails";
import { ModelTree } from "./model/ModelTree";

/**
 * The Model lens: the Page Objects on the page as a tree, and the Page
 * Object Models the page knows. It owns the page, object and model
 * selections. Rows report what the pointer is over for the page's dashed
 * highlight; the solid one follows the selection, which the frame pins.
 */
export function modelLens({
  host,
  pageModel,
  pageTools = [],
  selection,
  onSelect,
  onHover,
  renderRun,
  panes,
  onPanesChange,
}: {
  /** The page's host, e.g. localhost:5173. */
  host: string;
  pageModel: PageModel;
  /** The page-wide tools WebMCP publishes, e.g. snapshot. */
  pageTools?: readonly string[];
  selection: Selection;
  onSelect: (selection: Selection) => void;
  /** Called with what the pointer is over, for the page's dashed highlight. */
  onHover: OnHover;
  renderRun: RenderRun;
  /** The panes' open state and divider, which the panel remembers. */
  panes: ModelPanes;
  onPanesChange: (panes: ModelPanes) => void;
}): Lens {
  const nodes = [...walk(pageModel.objects)];
  const byPath = new Map(nodes.map((node) => [node.path, node]));
  const objects = nodes.filter((node) => node.kind !== "collection");
  const live = objects.filter((node) => node.live).length;

  const selectPage = () => onSelect({ kind: "page" });
  const selectObject = (node: PageObjectNode) =>
    onSelect({ kind: "object", path: node.path });
  const selectModel = (className: string) =>
    onSelect({ kind: "model", className });
  const selectMember = (path: string) => onSelect({ kind: "member", path });
  const openObject = (path: string) => {
    const node = byPath.get(path);
    if (node) selectObject(node);
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
        onHover={onHover}
        onPickPage={selectPage}
        onPickObject={selectObject}
        onPickModel={selectModel}
        panes={panes}
        onPanesChange={onPanesChange}
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
            tools={pageTools}
            renderRun={renderRun}
            onHover={onHover}
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
            onHover={onHover}
            renderRun={renderRun}
            onOpenModel={selectModel}
            onOpenObject={openObject}
            onSelectMember={selectMember}
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
            onHover={onHover}
            renderRun={renderRun}
            onOpenModel={selectModel}
            onOpenObject={selectObject}
            onSelectMember={selectMember}
          />
        );
      }
      if (selected.kind === "member") {
        const member = findMember(pageModel, nodes, selected.path);
        if (!member)
          return <Empty>{selected.path} is no longer on the page.</Empty>;
        return (
          <MemberDetail
            member={member}
            onHover={onHover}
            onOpenModel={selectModel}
            onOpenObject={openObject}
          />
        );
      }
      return undefined;
    },
  };
}

/**
 * A selected member: one of a Page Object's members by its path, or one of
 * a model's members by its path on the model.
 */
function findMember(
  pageModel: PageModel,
  nodes: readonly PageObjectNode[],
  path: string
): MemberView | undefined {
  for (const node of nodes) {
    if (node.kind === "collection") continue;
    const member = node.members.find((candidate) => candidate.path === path);
    if (member)
      return {
        path,
        name: member.name,
        kind: member.kind,
        ...(member.className === undefined
          ? {}
          : { className: member.className }),
        ...(member.collection === undefined
          ? {}
          : { collection: member.collection }),
        live: member.live,
        state: member.live ? member.state : "not on the page",
        owner: { kind: "object", path: node.path },
        ...(member.objectPath === undefined
          ? {}
          : { objectPath: member.objectPath }),
      };
  }
  for (const model of pageModel.models) {
    const member = model.members.find((candidate) => candidate.path === path);
    if (!member) continue;
    const onInstances = model.instancePaths.flatMap(
      (instancePath) =>
        nodes
          .find((node) => node.path === instancePath)
          ?.members.filter(
            (candidate) => candidate.name === member.name && candidate.live
          ) ?? []
    ).length;
    return {
      path,
      name: member.name,
      kind: member.kind,
      ...(member.className === undefined
        ? {}
        : { className: member.className }),
      ...(member.collection === undefined
        ? {}
        : { collection: member.collection }),
      live: onInstances > 0,
      state: onInstances
        ? `on ${onInstances} of ${model.instancePaths.length} ${model.className} objects`
        : "not on the page",
      owner: { kind: "model", className: model.className },
    };
  }
  return undefined;
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
    ...(node.live ? { highlightPath: node.path } : {}),
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
          !action.liveToolNames.length && "Not on page.",
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
        // A member selection needs the member on the page.
        selection: onPage
          ? ({ kind: "member", path: member.path } as const)
          : selection,
        ...(onPage ? { highlightPath: member.path } : {}),
      })),
    ];
  });
  return [...objectEntries, ...modelEntries];
}
