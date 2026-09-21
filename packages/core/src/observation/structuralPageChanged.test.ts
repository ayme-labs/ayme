import { describe, expect, it } from "vitest";
import { SyntheticAriaRefFactory } from "../tree/SyntheticAriaRefFactory";
import { StructuralTree } from "../tree/StructuralTree";
import { structuralPageChanged } from "./structuralPageChanged";

describe("structuralPageChanged", () => {
  it("reports false when the structural trees match", () => {
    const factory = new SyntheticAriaRefFactory();
    const tree = StructuralTree.fromAriaSnapshotYaml(
      '- button "Save" [ref=e1]',
      factory
    );
    expect(structuralPageChanged(tree, tree)).toBe(false);
  });

  it("reports true when the after tree differs from the decision tree", () => {
    const factory = new SyntheticAriaRefFactory();
    const before = StructuralTree.fromAriaSnapshotYaml(
      '- button "Save" [ref=e1]',
      factory
    );
    const after = StructuralTree.fromAriaSnapshotYaml(
      '- button "Save" [ref=e1]\n- dialog "Confirm" [ref=e2]',
      factory
    );
    expect(structuralPageChanged(before, after)).toBe(true);
  });
});
