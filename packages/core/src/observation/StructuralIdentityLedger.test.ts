import { describe, expect, it } from "vitest";
import { MonotonicTimeMsSchema } from "../capture/MonotonicTimeMs";
import { PageIdSchema } from "../capture/PageId";
import { StructuralTree } from "../tree/StructuralTree";
import { SyntheticAriaRefFactory } from "../tree/SyntheticAriaRefFactory";
import { AriaRefSchema } from "../tree/StructuralTypes";
import { StructuralActionIdSchema } from "./StructuralAction";
import { StructuralIdentityLedger } from "./StructuralIdentityLedger";
import { StructuralObservationSession } from "./StructuralObservationSession";
import { VisitIdSchema } from "./Visit";

const ref = AriaRefSchema.parse;
const PAGE = PageIdSchema.parse("page@test");
const START = { visitId: null, afterActionId: null };
const AFTER_SAVE = {
  visitId: VisitIdSchema.parse("visit_1"),
  afterActionId: StructuralActionIdSchema.parse("interaction_1"),
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
    ledger.advance(tree('- button "Save" [ref=e1]'), START);
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
    ledger.advance(tree('- button "Save" [ref=e1]'), START);
    ledger.advance(
      tree('- button "Save" [ref=e1]', '- status "Saved" [ref=e2]'),
      AFTER_SAVE
    );
    ledger.advance(tree('- button "Save" [ref=e1]'), START);

    expect(ledger.resolve(ref("e2"))).toMatchObject({
      status: "unresolved",
      reason: "removed",
    });
    expect(ledger.lifecycle(ref("e2"))).toEqual({
      appeared: AFTER_SAVE,
      disappeared: START,
    });
    expect(ledger.lifecycle(ref("e1"))).toEqual({
      appeared: START,
      disappeared: null,
    });
  });

  it("leaves a ref unresolved as ambiguous when two nodes claim its identity", () => {
    const ledger = new StructuralIdentityLedger();
    ledger.advance(tree('- button "Item" [ref=e1]'), START);
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

describe("StructuralObservationSession identity ledger", () => {
  it("reconciles observations in recording order and attributes each to its Visit and action", async () => {
    let now = 0;
    const session = new StructuralObservationSession({
      clock: { now: () => ++now },
    });
    const observe = (
      yaml: string,
      capturedForActionId?: ReturnType<typeof StructuralActionIdSchema.parse>
    ) => {
      const at = MonotonicTimeMsSchema.parse(++now);
      const observed = tree(yaml);
      session.recordObservation({
        kind: "observation",
        at,
        pageId: PAGE,
        tree: { pageId: PAGE, capturedAt: at, resolve: async () => observed },
        ...(capturedForActionId ? { capturedForActionId } : {}),
      });
    };

    session.recordNavigation({
      pageId: PAGE,
      url: "https://example.test/",
      cause: "initial",
    });
    observe('- button "Save" [ref=e1]');
    const actionId = StructuralActionIdSchema.parse("interaction_1");
    session.recordActionStarted({
      kind: "action-started",
      at: MonotonicTimeMsSchema.parse(++now),
      pageId: PAGE,
      actionId,
    });
    observe('- button "Save" [ref=e4]\n- status "Saved" [ref=e5]', actionId);

    const ledger = await session.identityLedger(PAGE);

    expect(ledger.resolve(ref("e1"))).toMatchObject({ currentRef: "e4" });
    expect(ledger.lifecycle(ref("e5"))?.appeared).toEqual({
      visitId: "visit_1",
      afterActionId: actionId,
    });
    expect(ledger.lifecycle(ref("e1"))?.appeared).toEqual({
      visitId: "visit_1",
      afterActionId: null,
    });
  });
});
