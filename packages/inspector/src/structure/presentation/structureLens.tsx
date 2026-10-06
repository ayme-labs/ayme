import { ArrowRightIcon, BoxIcon, BracesIcon, WrenchIcon } from "lucide-react";

import { Badge } from "@ayme-dev/design-system/components/badge";
import { cn } from "@ayme-dev/design-system/lib/utils";

import {
  structureRows,
  type MemberOwner,
  type StructureNode,
  type StructureRow,
  type StructureTree,
} from "../domain/structure";
import { Empty, WhatTheModelSees } from "../../shared";
import type {
  Lens,
  OnHover,
  RenderRun,
  SearchEntry,
  Selection,
} from "../../navigation";

/**
 * Marks the Structure lens's tree, a rendering of the page's structure. A
 * page dogfooding the Inspector keeps it out of the structure it renders.
 */
export const INSPECTOR_STRUCTURE_TREE_ATTRIBUTE =
  "data-ayme-inspector-structure";

/** Whether the structure is being captured, or why it couldn't be. */
export type StructureCapture = {
  error?: string;
  loading: boolean;
};

/** A live single-element tool: it runs on one node, by ref. */
export type ElementToolSummary = {
  name: string;
  /** Its input schema, as an agent receives it. */
  inputSchema: unknown;
  /** The refs it can take now, as the Goal Loop would offer them. */
  refs: readonly string[];
};

type RefNode = StructureNode & { ref: string };

/**
 * The Structure lens: the Structural Page State an agent receives, as a
 * tree with each node tagged by the Page Object member it maps to. It owns
 * `node` selections. A node's detail runs the single-element tools that can take its
 * ref and shows what the model sees of it. Hovering a node highlights it on
 * the page; the app highlights the selected one.
 */
export function structureLens({
  structure,
  capture,
  selection,
  onSelect,
  onHover,
  elementTools,
  renderRun,
}: {
  structure: StructureTree;
  capture: StructureCapture;
  selection: Selection;
  onSelect: (selection: Selection) => void;
  onHover: OnHover;
  elementTools: readonly ElementToolSummary[];
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
        selectedRef={selection.kind === "node" ? selection.ref : undefined}
        onPick={(ref) => onSelect({ kind: "node", ref })}
        onHover={onHover}
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
              description: node.memberLinks?.length
                ? node.memberLinks.map(({ member }) => member).join(", ")
                : "no member",
              selection: { kind: "node", ref: node.ref },
              highlight: { ref: node.ref },
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
          onOpenOwner={(owner) =>
            onSelect(
              "model" in owner
                ? { kind: "model", className: owner.model }
                : { kind: "object", path: owner.object }
            )
          }
          elementTools={elementTools}
          renderRun={renderRun}
        />
      );
    },
  };
}

function StructureTreeView({
  rows,
  capture,
  selectedRef,
  onPick,
  onHover,
}: {
  rows: readonly StructureRow[];
  capture: StructureCapture;
  selectedRef?: string;
  onPick: (ref: string) => void;
  onHover: OnHover;
}) {
  return (
    <div className="flex flex-col gap-1">
      {capture.error && (
        <p role="alert" className="px-1.5 text-xs text-destructive">
          {capture.error}
        </p>
      )}
      {rows.length ? (
        <div
          role="tree"
          aria-label="Page structure"
          {...{ [INSPECTOR_STRUCTURE_TREE_ATTRIBUTE]: "" }}
          className="flex flex-col"
        >
          {rows.map(({ node, depth }, index) =>
            hasRef(node) ? (
              <NodeRow
                key={node.ref}
                node={node}
                depth={depth}
                selected={node.ref === selectedRef}
                onPick={onPick}
                onHover={onHover}
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
  onHover,
}: {
  node: RefNode;
  depth: number;
  selected: boolean;
  onPick: (ref: string) => void;
  onHover: OnHover;
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
      onMouseEnter={() => onHover({ ref: node.ref })}
      onMouseLeave={() => onHover(undefined)}
    >
      <span className="text-primary">{node.ref}</span>
      <span>{node.role}</span>
      {node.name && (
        <span className={nameClass}>{JSON.stringify(node.name)}</span>
      )}
      {node.member && (
        <span
          className="ml-auto max-w-[45%] min-w-0 shrink-0 truncate pl-1.5 text-xs text-muted-foreground"
          title={node.member}
        >
          {node.tag}
        </span>
      )}
    </button>
  );
}

function NodeDetail({
  node,
  onOpenOwner,
  elementTools,
  renderRun,
}: {
  node: RefNode;
  onOpenOwner: (owner: MemberOwner) => void;
  elementTools: readonly ElementToolSummary[];
  renderRun: RenderRun;
}) {
  const members = node.memberLinks ?? [];
  const tools = elementTools.filter((tool) => tool.refs.includes(node.ref));
  return (
    <article aria-label="Structure node" className="grid gap-3">
      <div className="flex items-start gap-2.5">
        <div className="grid min-w-0 flex-1 gap-0.5">
          <h2 className="font-mono text-sm font-semibold break-all">
            {nodeLabel(node)}
          </h2>
          <p className="text-xs text-muted-foreground">Structure node</p>
        </div>
        <Badge variant="secondary">ref {node.ref}</Badge>
      </div>
      {members.length ? (
        <div
          role="group"
          aria-label="Page object members"
          className="flex flex-wrap gap-1.5"
        >
          {members.map(({ member, owner }) => {
            const model = "model" in owner;
            const opens = model ? owner.model : owner.object;
            const Icon = model ? BracesIcon : BoxIcon;
            return (
              <button
                key={member}
                type="button"
                title={`Open ${opens}`}
                className="inline-flex h-7 max-w-full items-center gap-1.5 rounded-full border bg-card px-2.5 text-xs hover:border-ring"
                onClick={() => onOpenOwner(owner)}
              >
                <Icon className="size-3.5 flex-none" aria-hidden />
                <span className="truncate font-mono">{member}</span>
                <ArrowRightIcon className="size-3.5 flex-none" aria-hidden />
              </button>
            );
          })}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          No page object member maps to this node. Agents can still act on it by
          ref.
        </p>
      )}
      {tools.length > 0 && (
        <section aria-label="Tools" className="grid gap-2">
          <h3 className="flex items-center gap-1.5 text-xs font-semibold tracking-wider text-muted-foreground uppercase">
            <WrenchIcon className="size-3.5" aria-hidden />
            Tools · {tools.length}
          </h3>
          {tools.map((tool) => (
            <div key={tool.name} role="group" aria-label={tool.name}>
              {renderRun({ toolName: tool.name, ref: node.ref })}
            </div>
          ))}
        </section>
      )}
      <WhatTheModelSees
        pageState={{
          lines: node.pageStateLines ?? [],
          childCount: node.childCount ?? 0,
        }}
        schemas={tools.map(({ name, inputSchema }) => ({ name, inputSchema }))}
      />
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
