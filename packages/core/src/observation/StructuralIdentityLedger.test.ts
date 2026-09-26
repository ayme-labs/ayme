import { describe, expect, it } from "vitest";
import { StructuralTree } from "../tree/StructuralTree";
import { SyntheticAriaRefFactory } from "../tree/SyntheticAriaRefFactory";
import { AriaRefSchema } from "../tree/StructuralTypes";
import { StructuralActionIdSchema } from "./StructuralAction";
import { StructuralIdentityLedger } from "./StructuralIdentityLedger";
import { VisitIdSchema } from "./Visit";

const ref = AriaRefSchema.parse;
const BEFORE_ANY_ACTION = { visitId: null, afterActionId: null };
const AFTER_SAVE = {
  visitId: VisitIdSchema.parse("visit_1"),
  afterActionId: StructuralActionIdSchema.parse("interaction_1"),
};
const AFTER_CLEAR = {
  visitId: VisitIdSchema.parse("visit_1"),
  afterActionId: StructuralActionIdSchema.parse("interaction_2"),
};

function tree(...lines: string[]): StructuralTree {
  return StructuralTree.fromAriaSnapshotYaml(
    lines.join("\n"),
    new SyntheticAriaRefFactory()
  );
}

describe("StructuralIdentityLedger", () => {
  it("makes every ref it observed an alias of the identity's current ref", () => {
    const ledger = new StructuralIdentityLedger();
    ledger.advance(tree('- button "Save" [ref=e1]'), BEFORE_ANY_ACTION);
    ledger.advance(tree('- button "Save" [ref=e7]'), AFTER_SAVE);
    ledger.advance(tree('- button "Save" [ref=e9]'), AFTER_SAVE);

    for (const requested of ["e1", "e7", "e9"])
      expect(ledger.resolve(ref(requested))).toEqual({
        status: "resolved",
        requestedRef: ref(requested),
        currentRef: ref("e9"),
      });
    expect(ledger.resolve(ref("e2"))).toMatchObject({ reason: "unknown-ref" });
  });

  it("records a removal as an unresolved state with the moment it disappeared", () => {
    const ledger = new StructuralIdentityLedger();
    ledger.advance(tree('- button "Save" [ref=e1]'), BEFORE_ANY_ACTION);
    ledger.advance(
      tree('- button "Save" [ref=e1]', '- status "Saved" [ref=e2]'),
      AFTER_SAVE
    );
    ledger.advance(tree('- button "Save" [ref=e1]'), AFTER_CLEAR);

    expect(ledger.resolve(ref("e2"))).toMatchObject({
      status: "unresolved",
      reason: "removed",
    });
    expect(ledger.lifecycle(ref("e2"))).toEqual({
      appeared: AFTER_SAVE,
      disappeared: AFTER_CLEAR,
    });
    expect(ledger.lifecycle(ref("e1"))).toEqual({
      appeared: BEFORE_ANY_ACTION,
      disappeared: null,
    });
  });

  it("leaves a ref unresolved as ambiguous when two nodes claim its identity", () => {
    const ledger = new StructuralIdentityLedger();
    ledger.advance(tree('- button "Item" [ref=e1]'), BEFORE_ANY_ACTION);
    ledger.advance(
      tree('- button "Item" [ref=e2]', '- button "Item" [ref=e3]'),
      AFTER_SAVE
    );

    expect(ledger.resolve(ref("e1"))).toMatchObject({
      status: "unresolved",
      reason: "ambiguous",
    });
  });
});
