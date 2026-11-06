import type {
  InspectorRecordedPageState,
  ProjectedStructuralNode,
} from "@ayme-dev/ayme/inspector";

import { nodeLabel } from "../../shared";

/**
 * What the recorded page state called the element `ref` named: its role and
 * name, or its direct text when it has no name. Undefined when it holds no
 * such ref, or the element is an unnamed generic one: nothing to say of it.
 */
export function recordedTargetName(
  recorded: Pick<InspectorRecordedPageState, "projected"> | undefined,
  ref: string
): string | undefined {
  const found = recorded && find(recorded.projected.roots, ref);
  const label = found && nodeLabel(found);
  return label && label !== "generic" ? label : undefined;
}

function find(
  entries: readonly (ProjectedStructuralNode | string)[],
  ref: string
): ProjectedStructuralNode | undefined {
  for (const entry of entries) {
    if (typeof entry === "string") continue;
    if (entry.ref === ref) return entry;
    const inside = find(entry.children, ref);
    if (inside) return inside;
  }
  return undefined;
}
