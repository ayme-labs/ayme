import { useEffect } from "react";
import {
  BoxIcon,
  BracesIcon,
  ChevronRightIcon,
  WrenchIcon,
} from "lucide-react";

import { Badge } from "@ayme-dev/design-system/components/badge";
import { cn } from "@ayme-dev/design-system/lib/utils";

import {
  structureRows,
  type MemberOwner,
  type StructureNode,
  type StructureTree,
} from "../domain/structure";
import {
  shownUnfolded,
  toggleChain,
  treeRows,
  type TreeRow,
} from "../domain/treeRows";
import {
  chip,
  Empty,
  focusRing,
  INSPECTOR_PAGE_RENDERING_ATTRIBUTE,
  WhatTheModelSees,
} from "../../shared";
import type {
  Lens,
  OnHover,
  RenderRun,
  SearchEntry,
  Selection,
} from "../../navigation";

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
 *
 * Chains of generic wrappers fold into one row, see {@link treeRows}. A
 * chain is unfolded while its outermost wrapper's ref is in
 * `unfoldedChains`, or while a wrapper the fold hides is selected, see
 * {@link shownUnfolded}. The app drops refs that leave the page.
 */
export function structureLens({
  structure,
  capture,
  selection,
  onSelect,
  onHover,
  elementTools,
  renderRun,
  unfoldedChains,
  onUnfoldedChainsChange,
}: {
  structure: StructureTree;
  capture: StructureCapture;
  selection: Selection;
  onSelect: (selection: Selection) => void;
  onHover: OnHover;
  elementTools: readonly ElementToolSummary[];
  renderRun: RenderRun;
  /** The outermost wrappers' refs of the chains the person unfolded. */
  unfoldedChains: ReadonlySet<string>;
  onUnfoldedChainsChange: (unfoldedChains: ReadonlySet<string>) => void;
}): Lens {
  const rows = [...structureRows(structure.roots)];
  const selectedRef = selection.kind === "node" ? selection.ref : undefined;
  // A picked wrapper the fold hides unfolds its chain, which then stays
  // unfolded like one the person unfolded.
  const shown = shownUnfolded(structure.roots, unfoldedChains, selectedRef);
  const shownRows = [
    ...treeRows(structure.roots, (chain) => shown.has(chain[0]!.ref!)),
  ];
  const toggle = (outer: RefNode) => {
    const { unfolded, select } = toggleChain(shown, outer, selectedRef);
    if (select) onSelect({ kind: "node", ref: select });
    onUnfoldedChainsChange(unfolded);
  };
  return {
    id: "structure",
    label: "Structure",
    tree: (
      <StructureTreeView
        rows={shownRows}
        capture={capture}
        selectedRef={selectedRef}
        onPick={(ref) => onSelect({ kind: "node", ref })}
        onToggle={toggle}
        onHover={onHover}
        store={
          shown === unfoldedChains
            ? undefined
            : () => onUnfoldedChainsChange(shown)
        }
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
  onToggle,
  onHover,
  store,
}: {
  rows: readonly TreeRow[];
  capture: StructureCapture;
  selectedRef?: string;
  onPick: (ref: string) => void;
  onToggle: (outer: RefNode) => void;
  onHover: OnHover;
  /** Stores the unfolded chains as this tree shows them, when they differ. */
  store?: () => void;
}) {
  useEffect(() => store?.(), [store]);
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
          {...{ [INSPECTOR_PAGE_RENDERING_ATTRIBUTE]: "" }}
          // Monospace, so `ch` below measures the rows' characters.
          className="flex flex-col font-mono text-xs"
          // The panel scrolls sideways only when a row's indent leaves no
          // room for what it never cuts.
          style={{ minWidth: treeMinWidth(rows) }}
        >
          {rows.map((row, index) =>
            hasRef(row.node) ? (
              <NodeRow
                key={row.node.ref}
                row={{ ...row, node: row.node }}
                selectedRef={selectedRef}
                onPick={onPick}
                onToggle={onToggle}
                onHover={onHover}
              />
            ) : (
              // Text has no ref: agents read it but cannot act on it.
              <div
                key={index}
                role="treeitem"
                aria-level={row.depth + 1}
                aria-selected={false}
                aria-disabled
                className={rowClass}
                style={{ paddingLeft: rowIndent(row.depth) }}
              >
                <span dir="auto" className={nameClass} title={row.node.name}>
                  {JSON.stringify(row.node.name)}
                </span>
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

// Rows never scroll sideways: past the panel's width the name is cut
// first, the member tag only past its share.
const rowClass =
  "relative flex items-baseline gap-1.5 overflow-hidden rounded-md px-1.5 py-1 text-left font-mono text-xs whitespace-nowrap";
const nameClass =
  // Stryker disable next-line StringLiteral: Tailwind classes are styling, which no test reads.
  "min-w-0 shrink-[1000] truncate text-green-700 dark:text-green-300";

// The indent leaves a gutter for the fold toggle.
function rowIndent(depth: number) {
  return 18 + depth * 12;
}

/**
 * The tree's narrowest width: what its widest row needs for what it never
 * cuts, its indent, refs and role, and on a folded row the outer ref, the
 * pill and the `›`. One term per depth, the row there with the most
 * characters, since rows at one depth share their pixels.
 */
function treeMinWidth(rows: readonly TreeRow[]) {
  const chars = new Map<number, number>();
  for (const { node, depth, folded } of rows) {
    // Each item is followed by a 6px gap; the row ends in 6px of padding.
    let width = `${node.ref ?? ""} ${node.role} `.length;
    if (folded)
      width += `${folded.outer.ref} ${folded.hidden || ""} more › `.length;
    chars.set(depth, Math.max(chars.get(depth) ?? 0, width));
  }
  const terms = [...chars].map(
    ([depth, width]) => `calc(${rowIndent(depth) + 30}px + ${width}ch)`
  );
  return `max(${terms.join(", ")})`;
}

/**
 * A node's row. A folded row is the generic its chain of wrappers ends in,
 * led by the chain's outermost wrapper: `e1 [1 more] › e3 generic`. Each ref
 * picks its node; the rest of the row picks the row's node.
 */
function NodeRow({
  row: { node, depth, folded, unfolded },
  selectedRef,
  onPick,
  onToggle,
  onHover,
}: {
  row: TreeRow & { node: RefNode };
  selectedRef?: string;
  onPick: (ref: string) => void;
  onToggle: (outer: RefNode) => void;
  onHover: OnHover;
}) {
  const outer = folded && hasRef(folded.outer) ? folded.outer : undefined;
  const hidden = folded?.hidden ?? 0;
  const toggle = outer ?? (unfolded ? node : undefined);
  return (
    <div
      role="treeitem"
      aria-level={depth + 1}
      aria-selected={node.ref === selectedRef}
      aria-label={
        outer
          ? `${nodeLabel(node)}, wrapped from ${outer.ref}`
          : nodeLabel(node)
      }
      className={cn(
        rowClass,
        "cursor-default hover:bg-muted",
        node.ref === selectedRef && "bg-accent hover:bg-accent"
      )}
      style={{ paddingLeft: rowIndent(depth) }}
      onClick={() => onPick(node.ref)}
      onMouseEnter={() => onHover({ ref: node.ref })}
      onMouseLeave={() => onHover(undefined)}
    >
      {toggle && (
        <button
          type="button"
          aria-label={outer ? "Unfold wrappers" : "Fold wrappers"}
          // The wrappers' state, not the row's: the row's children show either way.
          aria-expanded={!outer}
          data-chain={toggle.ref}
          className={cn(
            // Stryker disable next-line StringLiteral: Tailwind classes are styling, which no test reads.
            "absolute top-1.5 rounded-sm text-muted-foreground hover:text-foreground",
            focusRing
          )}
          style={{ left: rowIndent(depth) - 15 }}
          onClick={(event) => {
            event.stopPropagation();
            const tree = event.currentTarget.closest('[role="tree"]');
            const focused = event.currentTarget.matches(":focus");
            onToggle(toggle);
            // The toggle moves to the chain's other row: focus follows it.
            if (focused)
              requestAnimationFrame(() =>
                tree
                  ?.querySelector<HTMLElement>(`[data-chain="${toggle.ref}"]`)
                  ?.focus()
              );
          }}
        >
          <ChevronRightIcon
            // Stryker disable next-line StringLiteral,ConditionalExpression,LogicalOperator,BooleanLiteral: Tailwind classes are styling, which no test reads.
            className={cn("size-3", !outer && "rotate-90")}
            aria-hidden
          />
        </button>
      )}
      {outer && (
        <>
          <button
            type="button"
            aria-label={`${outer.ref} generic`}
            aria-pressed={outer.ref === selectedRef}
            className={cn(
              // Stryker disable next-line StringLiteral: Tailwind classes are styling, which no test reads.
              "shrink-0 rounded-sm text-primary hover:underline aria-pressed:bg-accent aria-pressed:underline",
              focusRing
            )}
            onClick={(event) => {
              event.stopPropagation();
              onPick(outer.ref);
            }}
            onMouseEnter={() => onHover({ ref: outer.ref })}
            onMouseLeave={() => onHover({ ref: node.ref })}
          >
            {outer.ref}
          </button>
          {hidden > 0 && (
            // The toggle already says this to assistive technology.
            <button
              type="button"
              tabIndex={-1}
              aria-hidden
              className="shrink-0 self-center rounded-full border bg-muted px-1.5 font-sans text-[11px] leading-4 text-muted-foreground hover:text-foreground"
              onClick={(event) => {
                event.stopPropagation();
                onToggle(outer);
              }}
            >
              {hidden} more
            </button>
          )}
          <span className="shrink-0 text-muted-foreground" aria-hidden>
            ›
          </span>
        </>
      )}
      <button
        type="button"
        className={cn(
          "flex min-w-0 flex-1 items-baseline gap-1.5 rounded-sm text-left",
          focusRing
        )}
      >
        <span className="shrink-0 text-primary">{node.ref}</span>
        <span className="shrink-0">{node.role}</span>
        {node.name && (
          <span dir="auto" className={nameClass} title={node.name}>
            {JSON.stringify(node.name)}
          </span>
        )}
        {node.member && (
          <span
            data-member-tag
            className="ml-auto max-w-[45%] min-w-0 truncate pl-1.5 text-xs text-muted-foreground"
            title={node.member}
          >
            {node.tag}
          </span>
        )}
      </button>
    </div>
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
    <article aria-label="Structure node" className="grid grid-cols-1 gap-3">
      <div className="flex items-start gap-2.5">
        <div className="grid min-w-0 flex-1 gap-0.5">
          <h2 className="font-mono text-sm font-semibold [overflow-wrap:anywhere]">
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
                title={member}
                aria-description={`Opens ${opens}`}
                className={chip}
                onClick={() => onOpenOwner(owner)}
              >
                <Icon className="size-3 flex-none" aria-hidden />
                <span className="truncate font-mono">{member}</span>
                <ChevronRightIcon className="size-3 flex-none" aria-hidden />
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
        <section aria-label="Tools" className="grid grid-cols-1 gap-2">
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
