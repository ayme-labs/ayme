import type { StructuralNode, StructuralRole } from "../tree/StructuralNode";
import type { AriaRef } from "../tree/StructuralTypes";
import { joinAdjacentText } from "./StructuralNodeForest";
import type {
  ProjectedStructuralNode,
  ProjectedStructuralNodeForest,
} from "./StructuralProjection";

/** One projected node as JSON: the shape the Goal Loop sends the model. */
export type JsonStructuralNode = Readonly<{
  ref: AriaRef;
  role: StructuralRole;
  name: string;
  /** Only when some state is set. */
  state?: StructuralNode["state"];
  /** Only when set. */
  cursorPointer?: true;
  /** The projected properties by key; only when there are any. */
  props?: Readonly<Record<string, string | readonly string[]>>;
  children: readonly (JsonStructuralNode | string)[];
}>;

export type JsonStructuralNodeForest = readonly (JsonStructuralNode | string)[];

/**
 * The JSON renderer: one object per projected node, its properties keyed by
 * their projected key, adjacent text children joined into one string. The
 * projection's identity token, status, prefixes and compact mark have no place
 * in this shape; the ref identifies a node.
 */
export function renderJsonStructuralNodeForest(
  forest: ProjectedStructuralNodeForest
): JsonStructuralNodeForest {
  return Object.freeze(joinAdjacentText(forest.roots).map(renderChild));
}

function renderChild(
  child: ProjectedStructuralNode | string
): JsonStructuralNode | string {
  return typeof child === "string" ? child : renderNode(child);
}

function renderNode(node: ProjectedStructuralNode): JsonStructuralNode {
  const hasState = Object.values(node.state).some(
    (value) => value !== undefined
  );
  return Object.freeze({
    ref: node.ref,
    role: node.role,
    name: node.name,
    ...(hasState ? { state: node.state } : {}),
    ...(node.cursorPointer ? { cursorPointer: true as const } : {}),
    ...(node.properties.length > 0
      ? {
          props: Object.freeze(
            Object.fromEntries(
              node.properties.map((property) => [property.key, property.value])
            )
          ),
        }
      : {}),
    children: Object.freeze(joinAdjacentText(node.children).map(renderChild)),
  });
}
