import type { StructuralEnrichmentSelection } from "../tree/StructuralEnrichment";
import { refAttribute } from "../tree/StructuralRef";
import type { AriaRef } from "../tree/StructuralTypes";
import type {
  StructuralNode,
  StructuralNodeStatus,
  StructuralRole,
} from "../tree/StructuralNode";

export type ProjectedStructuralProperty = Readonly<{
  key: string;
  label: string;
  value: string | readonly string[];
}>;

export type ProjectedStructuralNode = Readonly<{
  ref: AriaRef;
  identityToken: string | undefined;
  status: StructuralNodeStatus | undefined;
  prefixes: readonly string[];
  role: StructuralRole;
  name: string;
  state: StructuralNode["state"];
  cursorPointer: boolean;
  properties: readonly ProjectedStructuralProperty[];
  children: readonly (ProjectedStructuralNode | string)[];
  compact: boolean;
}>;

export type ProjectedStructuralNodeForest = Readonly<{
  roots: readonly (ProjectedStructuralNode | string)[];
}>;

export type StructuralNodeForestSource<TNode> = Readonly<{
  roots: readonly (TNode | string)[];
  children(node: TNode): readonly (TNode | string)[];
  structuralNode(node: TNode): StructuralNode;
  /**
   * Marks this node compact. A compact node omits text children and retains only direct node children whose projected
   * subtree contains a disclosed property. Each retained child follows its own compact decision.
   */
  compact?(node: TNode): boolean;
}>;

export type StructuralProjection<TNode = StructuralNode> = Readonly<{
  includeNode?(entry: TNode, node: StructuralNode): boolean;
  includeIdentity: boolean;
  identityToken?(entry: TNode, node: StructuralNode): string | undefined;
  includeStatus: boolean;
  status?(entry: TNode, node: StructuralNode): StructuralNodeStatus | undefined;
  prefixes?(entry: TNode, node: StructuralNode): readonly string[];
  structuralProperties: readonly string[] | null;
  enrichment: readonly StructuralEnrichmentSelection[];
  includeEnrichment?(
    entry: TNode,
    node: StructuralNode,
    selection: StructuralEnrichmentSelection
  ): boolean;
  includeProperty?(
    entry: TNode,
    node: StructuralNode,
    property: ProjectedStructuralProperty
  ): boolean;
  properties?(
    entry: TNode,
    node: StructuralNode
  ): readonly ProjectedStructuralProperty[];
}>;

export function defineStructuralProjection<TNode = StructuralNode>(
  options: Partial<StructuralProjection<TNode>> = {}
): StructuralProjection<TNode> {
  const structuralProperties = options.structuralProperties;
  return Object.freeze({
    ...options,
    includeIdentity: options.includeIdentity ?? true,
    includeStatus: options.includeStatus ?? true,
    structuralProperties:
      structuralProperties === undefined || structuralProperties === null
        ? null
        : Object.freeze([...structuralProperties]),
    enrichment: Object.freeze([...(options.enrichment ?? [])]),
  });
}

export function projectStructuralNodeForest<TNode>(
  source: StructuralNodeForestSource<TNode>,
  options: Partial<StructuralProjection<TNode>> = {}
): ProjectedStructuralNodeForest {
  const projection = defineStructuralProjection(options);
  const project = (
    entry: TNode | string
  ): ProjectedStructuralNode | string | null => {
    if (typeof entry === "string") return entry;
    const node = source.structuralNode(entry);
    if (projection.includeNode?.(entry, node) === false) return null;
    const properties: ProjectedStructuralProperty[] = Object.entries(node.props)
      .filter(([key]) =>
        projection.structuralProperties === null
          ? true
          : projection.structuralProperties.includes(key)
      )
      .map(([key, value]) => ({ key, label: key, value }))
      .filter(
        (property) =>
          projection.includeProperty?.(entry, node, property) !== false
      );
    for (const selection of projection.enrichment) {
      if (projection.includeEnrichment?.(entry, node, selection) === false)
        continue;
      for (const property of node.enrichmentProperties(
        selection.kind,
        selection.propertyKeys
      )) {
        const projected = {
          key: `${selection.kind.key}.${property.key}`,
          label: property.key,
          value: property.value,
        };
        if (projection.includeProperty?.(entry, node, projected) !== false)
          properties.push(projected);
      }
    }
    properties.push(
      ...(projection.properties?.(entry, node) ?? []).filter(
        (property) =>
          projection.includeProperty?.(entry, node, property) !== false
      )
    );
    const compact = source.compact?.(entry) ?? false;
    const projectedChildren = source
      .children(entry)
      .map(project)
      .filter(
        (child): child is ProjectedStructuralNode | string => child !== null
      );
    const children = compact
      ? projectedChildren.filter(
          (child): child is ProjectedStructuralNode =>
            typeof child !== "string" && subtreeHasProjectedProperties(child)
        )
      : projectedChildren;
    return Object.freeze({
      ref: node.ref,
      identityToken:
        projection.includeIdentity === false
          ? undefined
          : (projection.identityToken?.(entry, node) ?? refAttribute(node.ref)),
      status:
        projection.includeStatus === false
          ? undefined
          : (projection.status?.(entry, node) ?? node.status),
      prefixes: Object.freeze([...(projection.prefixes?.(entry, node) ?? [])]),
      role: node.role,
      name: node.name,
      state: node.state,
      cursorPointer: node.cursorPointer,
      properties: Object.freeze(properties),
      children: Object.freeze(children),
      compact: compact && properties.length === 0 && children.length === 0,
    });
  };
  return Object.freeze({
    roots: Object.freeze(
      source.roots
        .map(project)
        .filter(
          (node): node is ProjectedStructuralNode | string => node !== null
        )
    ),
  });
}

function subtreeHasProjectedProperties(node: ProjectedStructuralNode): boolean {
  return (
    node.properties.length > 0 ||
    node.children.some(
      (child) =>
        typeof child !== "string" && subtreeHasProjectedProperties(child)
    )
  );
}
