import type { StructureNode, StructureTree } from "../../structure";
import type { InteractionDescription } from "./run";

/** Describe the actual target, retaining a containing object's identity as context only. */
export function interactionTarget(
  ref: string | undefined,
  structure: StructureTree
): Omit<InteractionDescription, "target"> {
  if (!ref) return {};
  function visit(
    nodes: readonly StructureNode[],
    context?: string
  ): ReturnType<typeof interactionTarget> | undefined {
    for (const node of nodes) {
      if (node.ref === ref)
        return {
          ...(node.member ? { member: node.member } : {}),
          ...(context ? { context } : {}),
        };
      const found = visit(node.children, node.owner ?? context);
      if (found) return found;
    }
    return undefined;
  }
  return visit(structure.roots) ?? {};
}
