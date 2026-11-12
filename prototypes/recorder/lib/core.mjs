// Core from the workspace, as built (`pnpm --filter @ayme-dev/core build`).
// Tree parsing/rendering plus the public Node-only observation session.
import {
  StructuralTree,
  StructuralObservationSession,
  SyntheticAriaRefFactory,
  projectStructuralNodeForest,
  renderCompactStructuralNodeForest,
} from "../../../packages/core/dist/index.mjs";

export { StructuralTree, SyntheticAriaRefFactory };

/** One factory per recording, so synthetic refs never collide across trees. */
export function createParser() {
  const factory = new SyntheticAriaRefFactory();
  return {
    factory,
    parse: (yaml) => StructuralTree.fromAriaSnapshotYaml(yaml, factory),
    tree: (root) => new StructuralTree(root, factory),
  };
}

export const reconcile = (before, after) =>
  StructuralTree.reconcile(before, after);

const isChange = (node) =>
  node.status?.kind === "added" ||
  node.status?.kind === "removed" ||
  node.status?.kind === "updated";

/**
 * The Change Tree of a reconciled tree in core's compact notation: changed
 * subtrees and the path to them. Same pruning as `renderChangeRecord` in
 * packages/ayme (page-state/domain/changeRecord.ts), minus Page Object marks,
 * plus a mark on the interaction's target.
 *
 * `target` is { ref, exact }: `<target>` on the node itself, or
 * `<target-inside>` on its nearest ancestor that is in the tree.
 */
export function renderChangeTree(reconciled, target) {
  const keep = new Set();
  reconciled.walk((node) => {
    if (isChange(node) || node.ref === target?.ref) keep.add(node.ref);
  });
  if (keep.size === 0) return "";

  const cache = new Map();
  const hasKeptBelow = (node) => {
    const cached = cache.get(node);
    if (cached !== undefined) return cached;
    const result =
      keep.has(node.ref) ||
      node.children.some(
        (child) => typeof child !== "string" && hasKeptBelow(child)
      );
    cache.set(node, result);
    return result;
  };

  const projected = projectStructuralNodeForest(
    {
      roots: reconciled.getRootNodes().filter(hasKeptBelow),
      structuralNode: (node) => node,
      children: (node) => {
        const status = node.status;
        const withText =
          status?.kind === "added" ||
          status?.kind === "removed" ||
          (status?.kind === "updated" && status.selfChanged) ||
          node.ref === target?.ref;
        return node.children.filter((child) =>
          typeof child === "string" ? withText : hasKeptBelow(child)
        );
      },
    },
    {
      includeIdentity: true,
      includeStatus: true,
      prefixes: (node) =>
        node.ref === target?.ref
          ? [target.exact ? "<target>" : "<target-inside>"]
          : [],
    }
  );
  return renderCompactStructuralNodeForest(projected);
}

/** A whole tree in core's compact notation, refs included. */
export function renderTree(tree) {
  return renderCompactStructuralNodeForest(
    projectStructuralNodeForest(
      {
        roots: tree.getRootNodes(),
        structuralNode: (node) => node,
        children: (node) => node.children,
      },
      { includeIdentity: true, includeStatus: false }
    )
  );
}

export function changeCounts(reconciled) {
  const counts = { added: 0, removed: 0, changed: 0 };
  for (const node of reconciled.getChangeRootsByStatus("added")) {
    void node;
    counts.added += 1;
  }
  for (const node of reconciled.getChangeRootsByStatus("removed")) {
    void node;
    counts.removed += 1;
  }
  reconciled.walk((node) => {
    if (node.status?.kind === "updated" && node.status.selfChanged)
      counts.changed += 1;
  });
  return counts;
}

// Package identities are a presentation of the session ledger, not browser refs.
// Core exposes resolve/sameIdentity, but no first-ref projection.
export class Observations {
  constructor(parser, clock) {
    this.parser = parser;
    this.session = new StructuralObservationSession({ clock });
    this.aliases = new Map();
  }

  async observe(visit, snap, extra = {}) {
    if (snap.observation) return snap;
    const observation = this.session.recordObservation({
      kind: "observation", at: snap.tMono ?? performance.now(),
      pageId: visit.pageId, capturedForVisitId: visit.visitId,
      tree: { resolve: async () => snap.tree }, ...extra,
    });
    const refs = await this.session.readIdentityLedger(visit.pageId, (ledger) => {
      const previous = this.aliases.get(visit.visitId) ?? new Map();
      const current = new Map();
      for (const [alias, first] of previous) {
        const resolved = ledger.resolve(alias);
        if (resolved.status === "resolved" && snap.tree.hasNode(resolved.currentRef))
          current.set(resolved.currentRef, first);
      }
      for (const ref of snap.tree.getAllRefs()) {
        if (!current.has(ref)) current.set(ref, ref);
        previous.set(ref, current.get(ref));
      }
      this.aliases.set(visit.visitId, previous);
      return current;
    });
    snap.observation = observation;
    snap.refs = refs;
    snap.stableTree = this.remap(snap.tree, refs);
    return snap;
  }

  remap(tree, refs) {
    const copy = (node) => node.copy({
      ref: refs.get(node.ref) ?? node.ref,
      children: node.children.map((c) => typeof c === "string" ? c : copy(c)),
    });
    const result = this.parser.tree(copy(tree.root));
    if (result.findDuplicateRef()) throw new Error("first-ref projection collided");
    return result;
  }

  async change(visit, before, after) {
    const change = await this.session.readChange(visit.pageId, before.observation, after.observation);
    return this.remap(change, new Map([...before.refs, ...after.refs]));
  }
}
