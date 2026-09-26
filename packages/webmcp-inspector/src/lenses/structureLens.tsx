import { Button } from "@ayme-dev/design-system/components/button";

import type { StructureNode, StructureTree } from "../adapter/structure";
import { Empty } from "../common";
import type { Lens, SearchEntry } from "../frame/lens";
import type { Selection } from "../frame/selection";

/** The page state, as the skeleton shows it. */
export type PageStateText = {
  text?: string;
  capturedAt?: string;
  error?: string;
  loading: boolean;
};

/**
 * The Structure lens. Ticket F replaces this skeleton, which shows the page
 * state as text, on the structure tree model the adapter provides.
 */
export function structureLens({
  structure,
  pageState,
  onRefresh,
}: {
  structure: StructureTree;
  pageState: PageStateText;
  onRefresh: () => void;
}): Lens {
  const nodes = [...walk(structure.roots)];
  return {
    id: "structure",
    label: "Structure",
    tree: <PageStateView pageState={pageState} onRefresh={onRefresh} />,
    searchEntries: nodes.flatMap((node): SearchEntry[] =>
      node.ref === undefined
        ? []
        : [
            {
              key: `node:${node.ref}`,
              kind: "Ref",
              label: nodeLabel(node),
              description: node.member ?? "no member",
              selection: { kind: "node", ref: node.ref },
            },
          ]
    ),
    legend: { refs: structure.refCount },
    detail: (selection: Selection) => {
      if (selection.kind !== "node") return undefined;
      const node = nodes.find((candidate) => candidate.ref === selection.ref);
      if (!node) return <Empty>This node is no longer on the page.</Empty>;
      return (
        <div className="grid gap-1">
          <div className="font-mono text-[13.5px] font-semibold">
            {nodeLabel(node)}
          </div>
          <p className="text-xs text-muted-foreground">
            {node.member ??
              "No page object member maps to this node. Agents can still act on it by ref."}
          </p>
        </div>
      );
    },
  };
}

function PageStateView({
  pageState,
  onRefresh,
}: {
  pageState: PageStateText;
  onRefresh: () => void;
}) {
  return (
    <section aria-label="Structural page state" className="grid gap-2 p-1">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">Structural page state</h3>
        <Button
          size="sm"
          variant="outline"
          disabled={pageState.loading}
          onClick={onRefresh}
        >
          {pageState.loading ? "Refreshing…" : "Refresh"}
        </Button>
      </div>
      {pageState.error ? (
        <p role="alert" className="text-xs text-destructive">
          {pageState.error}
        </p>
      ) : pageState.text !== undefined ? (
        <pre className="overflow-auto rounded-md bg-muted p-2 font-mono text-xs whitespace-pre-wrap">
          {pageState.text}
        </pre>
      ) : (
        <Empty>
          {pageState.loading
            ? "Capturing page state…"
            : "Waiting for the first page-state capture."}
        </Empty>
      )}
      {pageState.capturedAt && (
        <p className="text-xs text-muted-foreground">
          Captured {pageState.capturedAt}
        </p>
      )}
    </section>
  );
}

function nodeLabel(node: StructureNode) {
  return [node.ref, node.role, node.name && JSON.stringify(node.name)]
    .filter(Boolean)
    .join(" ");
}

function* walk(nodes: readonly StructureNode[]): Generator<StructureNode> {
  for (const node of nodes) {
    yield node;
    yield* walk(node.children);
  }
}
