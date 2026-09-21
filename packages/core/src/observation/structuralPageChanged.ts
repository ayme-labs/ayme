import { StructuralTree } from "../tree/StructuralTree";

export function structuralPageChanged(
  before: StructuralTree,
  after: StructuralTree
): boolean {
  return StructuralTree.reconcile(before, after).hasAnyChanges();
}
