import {
  ArrowRightIcon,
  BoxIcon,
  RefreshCwIcon,
  WrenchIcon,
} from "lucide-react";

import { Badge } from "@ayme-dev/design-system/components/badge";
import { cn } from "@ayme-dev/design-system/lib/utils";

import {
  structureRows,
  type StructureNode,
  type StructureRow,
  type StructureTree,
} from "../adapter/structure";
import { Empty } from "../common";
import type { Lens, SearchEntry } from "../frame/lens";
import type { RenderRun } from "../frame/runSlot";
import type { Selection } from "../frame/selection";

/** How current the structure is. */
export type StructureCapture = {
  capturedAt?: string;
  error?: string;
  loading: boolean;
};

/** Highlighting a node of the structure on the page, by ref. */
export type RefHighlight = {
  previewRef: (ref: string) => void;
  clearPreview: () => void;
  togglePinnedRef: (ref: string) => void;
};

/** A published Ref tool: it runs on one node, by ref. */
export type RefToolSummary = { name: string };

type RefNode = StructureNode & { ref: string };

/**
 * The Structure lens: the Structural Page State an agent receives, as a
 * tree with each node tagged by the Page Object member it maps to. It owns
 * `node` selections, and a node's detail runs the Ref tools on it.
 */
export function structureLens({
  structure,
  capture,
  onRefresh,
  selection,
  onSelect,
  highlight,
  refTools,
  renderRun,
}: {
  structure: StructureTree;
  capture: StructureCapture;
  onRefresh: () => void;
  selection: Selection;
  onSelect: (selection: Selection) => void;
  highlight: RefHighlight;
  refTools: readonly RefToolSummary[];
  renderRun: RenderRun;
}): Lens {
  const rows = [...structureRows(structure.roots)];
  return {
    id: "structure",
    label: "Structure",
    tree: (
      <StructureTreeView
        rows={rows}
        capture={capture}
        onRefresh={onRefresh}
        selectedRef={selection.kind === "node" ? selection.ref : undefined}
        onPick={(ref) => {
          onSelect({ kind: "node", ref });
          highlight.togglePinnedRef(ref);
        }}
        highlight={highlight}
      />
    ),
    searchEntries: rows.flatMap(({ node }): SearchEntry[] =>
      node.ref === undefined
        ? []
        : [
            {
              key: `node:${node.ref}`,
              kind: "Ref",
              label: nodeLabel(node),
              description: node.member ?? "no member",
              selection: { kind: "node", ref: node.ref },
              highlightRef: node.ref,
            },
          ]
    ),
    legend: { refs: structure.refCount },
    detail: (selected: Selection) => {
      if (selected.kind !== "node") return undefined;
      const node = rows.find(({ node }) => node.ref === selected.ref)?.node;
      if (!hasRef(node))
        return <Empty>This node is no longer on the page.</Empty>;
      return (
        <NodeDetail
          node={node}
          onOpenOwner={(path) => onSelect({ kind: "object", path })}
          refTools={refTools}
          renderRun={renderRun}
        />
      );
    },
  };
}

function StructureTreeView({
  rows,
  capture,
  onRefresh,
  selectedRef,
  onPick,
  highlight,
}: {
  rows: readonly StructureRow[];
  capture: StructureCapture;
  onRefresh: () => void;
  selectedRef?: string;
  onPick: (ref: string) => void;
  highlight: RefHighlight;
}) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-1.5 pl-1.5 text-[11.5px] text-muted-foreground">
        <span className="flex-1 truncate">
          {capture.loading
            ? "Capturing…"
            : capture.capturedAt && `Captured ${capture.capturedAt}`}
        </span>
        <button
          type="button"
          aria-label="Refresh the page structure"
          title="Refresh the page structure"
          disabled={capture.loading}
          className="grid size-6 place-items-center rounded-md hover:bg-muted hover:text-foreground disabled:opacity-50"
          onClick={onRefresh}
        >
          <RefreshCwIcon className="size-3.5" aria-hidden />
        </button>
      </div>
      {capture.error && (
        <p role="alert" className="px-1.5 text-xs text-destructive">
          {capture.error}
        </p>
      )}
      {rows.length ? (
        <div role="tree" aria-label="Page structure" className="flex flex-col">
          {rows.map(({ node, depth }, index) =>
            hasRef(node) ? (
              <NodeRow
                key={node.ref}
                node={node}
                depth={depth}
                selected={node.ref === selectedRef}
                onPick={onPick}
                highlight={highlight}
              />
            ) : (
              // Text has no ref: agents read it but cannot act on it.
              <div
                key={index}
                role="treeitem"
                aria-level={depth + 1}
                aria-selected={false}
                aria-disabled
                className={rowClass}
                style={{ paddingLeft: rowIndent(depth) }}
              >
                <span className={nameClass}>{JSON.stringify(node.name)}</span>
              </div>
            )
          )}
        </div>
      ) : (
        !capture.error && (
          <Empty>
            {capture.loading
              ? "Capturing the page structure…"
              : "Nothing on the page yet."}
          </Empty>
        )
      )}
    </div>
  );
}

const rowClass =
  "flex w-full items-baseline gap-1.5 rounded px-1.5 py-1 text-left font-mono text-xs whitespace-nowrap";
const nameClass = "min-w-0 truncate text-green-700 dark:text-green-300";

function rowIndent(depth: number) {
  return 6 + depth * 12;
}

function NodeRow({
  node,
  depth,
  selected,
  onPick,
  highlight,
}: {
  node: RefNode;
  depth: number;
  selected: boolean;
  onPick: (ref: string) => void;
  highlight: RefHighlight;
}) {
  return (
    <button
      type="button"
      role="treeitem"
      aria-level={depth + 1}
      aria-selected={selected}
      className={cn(
        rowClass,
        "hover:bg-muted",
        selected && "bg-accent hover:bg-accent"
      )}
      style={{ paddingLeft: rowIndent(depth) }}
      onClick={() => onPick(node.ref)}
      onMouseEnter={() => highlight.previewRef(node.ref)}
      onMouseLeave={highlight.clearPreview}
    >
      <span className="text-primary">{node.ref}</span>
      <span>{node.role}</span>
      {node.name && (
        <span className={nameClass}>{JSON.stringify(node.name)}</span>
      )}
      {node.member && (
        <span
          className="ml-auto max-w-[45%] min-w-0 shrink-0 truncate pl-1.5 text-[10.5px] text-muted-foreground"
          title={node.member}
        >
          {shortMember(node.member)}
        </span>
      )}
    </button>
  );
}

function NodeDetail({
  node,
  onOpenOwner,
  refTools,
  renderRun,
}: {
  node: RefNode;
  onOpenOwner: (path: string) => void;
  refTools: readonly RefToolSummary[];
  renderRun: RenderRun;
}) {
  const { member, owner } = node;
  return (
    <article aria-label="Structure node" className="grid gap-3">
      <div className="flex items-start gap-2.5">
        <div className="grid min-w-0 flex-1 gap-0.5">
          <h2 className="font-mono text-[13.5px] font-semibold break-all">
            {nodeLabel(node)}
          </h2>
          <p className="text-xs text-muted-foreground">Structure node</p>
        </div>
        <Badge variant="secondary">ref {node.ref}</Badge>
      </div>
      {member !== undefined && owner !== undefined ? (
        <div role="group" aria-label="Page object member">
          <button
            type="button"
            title={`Open ${owner}`}
            className="inline-flex h-7 max-w-full items-center gap-1.5 rounded-full border bg-card px-2.5 text-xs hover:border-ring"
            onClick={() => onOpenOwner(owner)}
          >
            <BoxIcon className="size-3.5 flex-none" aria-hidden />
            <span className="truncate font-mono">{member}</span>
            <ArrowRightIcon className="size-3.5 flex-none" aria-hidden />
          </button>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          No page object member maps to this node. Agents can still act on it by
          ref.
        </p>
      )}
      {refTools.length > 0 && (
        <section aria-label="Tools" className="grid gap-2">
          <h3 className="flex items-center gap-1.5 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
            <WrenchIcon className="size-3.5" aria-hidden />
            Tools · {refTools.length}
          </h3>
          {refTools.map((tool) => (
            <div key={tool.name}>
              {renderRun({ toolName: tool.name, ref: node.ref })}
            </div>
          ))}
        </section>
      )}
    </article>
  );
}

function hasRef(node: StructureNode | undefined): node is RefNode {
  return node?.ref !== undefined;
}

/** The node as the page state lists it: `e3 button "Add item"`. */
function nodeLabel(node: StructureNode) {
  return [node.ref, node.role, node.name && JSON.stringify(node.name)]
    .filter(Boolean)
    .join(" ");
}

/**
 * The member tag in the tree, kept short: relative to the page, and a
 * collection item as `[·]`, since the node's name tells items apart. So
 * "ListPage.items[1].archiveButton" reads "[·].archiveButton".
 */
function shortMember(member: string) {
  const dot = member.indexOf(".");
  if (dot < 0) return member;
  return member.slice(dot).replace(/^\.\w+\[\d+\]/, "[·]");
}
