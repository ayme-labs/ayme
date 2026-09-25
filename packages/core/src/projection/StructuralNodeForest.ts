import type { StructuralChild, StructuralNode } from "../tree/StructuralNode";
import type { StructuralNodeForestSource } from "./StructuralProjection";

/**
 * A forest source that can also rebuild one of its nodes with other children.
 * The operations of {@link StructuralNodeForest} need nothing else.
 */
export type StructuralNodeForestAdapter<TNode> =
  StructuralNodeForestSource<TNode> &
    Readonly<{
      /**
       * A copy of `node` whose children are `children`, of the same node type.
       * `children(withChildren(node, list))` must report `list`.
       */
      withChildren(node: TNode, children: readonly (TNode | string)[]): TNode;
    }>;

/** Decides an operation for one node: the forest's entry and its structural node. */
export type StructuralNodePredicate<TNode> = (
  entry: TNode,
  node: StructuralNode
) => boolean;

/**
 * A forest of structural nodes as a model is shown it. It is a derived view:
 * the `StructuralTree` stays the complete reconciled fact, and every operation
 * here returns a new forest of the same node type, so operations chain and the
 * result feeds `projectStructuralNodeForest` unchanged.
 *
 * The four operations are complete by design:
 *
 * - `filter`: a non-matching node is dropped with its whole subtree.
 * - `filterAndPromote`: a non-matching node is dropped, but its matching node
 *   descendants are promoted into its place; its text children go with it.
 * - `collapse`: a matching node keeps its place and loses all its children.
 * - `explode`: a matching node is replaced by its children, text included.
 *
 * `explode` leaves adjacent text children as they are; the renderers join them.
 */
export class StructuralNodeForest<
  TNode,
> implements StructuralNodeForestSource<TNode> {
  readonly roots: readonly (TNode | string)[];

  constructor(
    private readonly adapter: StructuralNodeForestAdapter<TNode>,
    roots: readonly (TNode | string)[] = adapter.roots
  ) {
    this.roots = Object.freeze([...roots]);
  }

  children(node: TNode): readonly (TNode | string)[] {
    return this.adapter.children(node);
  }

  structuralNode(node: TNode): StructuralNode {
    return this.adapter.structuralNode(node);
  }

  compact(node: TNode): boolean {
    return this.adapter.compact?.(node) ?? false;
  }

  withChildren(node: TNode, children: readonly (TNode | string)[]): TNode {
    return this.adapter.withChildren(node, children);
  }

  /** Keeps matching nodes; a non-matching node is dropped with its whole subtree. */
  filter(
    predicate: StructuralNodePredicate<TNode>
  ): StructuralNodeForest<TNode> {
    const visit = (child: TNode | string): (TNode | string)[] => {
      if (typeof child === "string") return [child];
      if (!predicate(child, this.structuralNode(child))) return [];
      return [this.rebuild(child, this.children(child).flatMap(visit))];
    };
    return this.derive(this.roots.flatMap(visit));
  }

  /**
   * Keeps matching nodes; a non-matching node is dropped, its matching node
   * descendants are promoted into its place and its text children are dropped
   * with it.
   */
  filterAndPromote(
    predicate: StructuralNodePredicate<TNode>
  ): StructuralNodeForest<TNode> {
    const visit = (child: TNode | string): (TNode | string)[] => {
      if (typeof child === "string") return [child];
      if (!predicate(child, this.structuralNode(child)))
        return this.children(child).flatMap((grandchild) =>
          typeof grandchild === "string" ? [] : visit(grandchild)
        );
      return [this.rebuild(child, this.children(child).flatMap(visit))];
    };
    return this.derive(this.roots.flatMap(visit));
  }

  /** Keeps a matching node and drops all its children, text included. */
  collapse(
    predicate: StructuralNodePredicate<TNode>
  ): StructuralNodeForest<TNode> {
    const visit = (child: TNode | string): TNode | string => {
      if (typeof child === "string") return child;
      if (predicate(child, this.structuralNode(child)))
        return this.rebuild(child, []);
      return this.rebuild(child, this.children(child).map(visit));
    };
    return this.derive(this.roots.map(visit));
  }

  /**
   * Replaces a matching node by its children, text included and in order. The
   * predicate is evaluated bottom-up, on the node after its own children were
   * exploded, so a chain of matching wrappers vanishes as a whole.
   */
  explode(
    predicate: StructuralNodePredicate<TNode>
  ): StructuralNodeForest<TNode> {
    const visit = (child: TNode | string): (TNode | string)[] => {
      if (typeof child === "string") return [child];
      const exploded = this.rebuild(child, this.children(child).flatMap(visit));
      return predicate(exploded, this.structuralNode(exploded))
        ? [...this.children(exploded)]
        : [exploded];
    };
    return this.derive(this.roots.flatMap(visit));
  }

  private derive(
    roots: readonly (TNode | string)[]
  ): StructuralNodeForest<TNode> {
    return new StructuralNodeForest(this.adapter, roots);
  }

  /** The node itself when its children are unchanged, so untouched nodes keep their identity. */
  private rebuild(node: TNode, children: readonly (TNode | string)[]): TNode {
    const current = this.children(node);
    const unchanged =
      current.length === children.length &&
      current.every((child, index) => child === children[index]);
    return unchanged ? node : this.withChildren(node, children);
  }
}

/** The forest over structural nodes themselves, such as a tree's root nodes. */
export function structuralNodeForest(
  roots: readonly StructuralChild[]
): StructuralNodeForest<StructuralNode> {
  return new StructuralNodeForest<StructuralNode>({
    roots,
    children: (node) => node.children,
    structuralNode: (node) => node,
    withChildren: (node, children) => node.copy({ children: [...children] }),
  });
}

/**
 * Consecutive strings among `children` as one string each, in place. Exploding
 * a node leaves its text next to its neighbours' text; a renderer shows such a
 * run as the one text it is on the page.
 */
export function joinAdjacentText<T>(
  children: readonly (T | string)[]
): readonly (T | string)[] {
  const joined: (T | string)[] = [];
  for (const child of children) {
    const last = joined.length - 1;
    if (typeof child === "string" && typeof joined[last] === "string")
      joined[last] = `${joined[last] as string}${child}`;
    else joined.push(child);
  }
  return joined;
}
