import { describe, expect, it } from "vitest";
import {
  AriaRefSchema,
  StructuralTree,
  SyntheticAriaRefFactory,
} from "../index";

const ref = (value: string) => AriaRefSchema.parse(value);
const parse = (yaml: string) =>
  StructuralTree.fromAriaSnapshotYaml(yaml, new SyntheticAriaRefFactory());

describe("reconciliation facts", () => {
  it("exposes a unique match under its raw after ref", () => {
    const before = parse('- button "Save" [ref=e1]');
    const after = parse('- button "Save" [ref=e2]');
    expect(
      StructuralTree.reconcile(before, after).getBeforeNodeForAfterRef(
        ref("e2")
      )
    ).toBe(before.root);
  });
  it("reports competing matches without treating ordinary removals as ambiguous", () => {
    const before = parse(
      '- generic [ref=e1]:\n  - button "Duplicate" [ref=e2]\n  - link "Removed" [ref=e3]'
    );
    const after = parse(
      '- generic [ref=e1]:\n  - button "Duplicate" [disabled] [ref=e4]\n  - button "Duplicate" [disabled] [ref=e5]'
    );
    const reconciled = StructuralTree.reconcile(before, after);
    expect(reconciled.wasBeforeRefAmbiguous(ref("e2"))).toBe(true);
    expect(reconciled.wasBeforeRefAmbiguous(ref("e3"))).toBe(false);
    expect(reconciled.getBeforeNodeForAfterRef(ref("e4"))).toBeNull();
  });
});

function parsePair(before: string, after: string) {
  return [parse(before), parse(after)] as const;
}
describe("StructuralTree.reconcile aria-ref identity", () => {
  const BEFORE = `
- list [ref=e1]:
  - checkbox "Buy milk" [ref=e2]
`.trim();
  const AFTER = `
- list [ref=e3]:
  - checkbox "Buy milk" [checked] [ref=e4]
`.trim();

  it("exposes lineage by the raw after ref when a synthetic ref is preserved", () => {
    const factory = new SyntheticAriaRefFactory();
    const before = StructuralTree.fromAriaSnapshotYaml("- generic", factory);
    const after = StructuralTree.fromAriaSnapshotYaml("- generic", factory);
    const beforeRef = before.root.ref;
    const afterRef = after.root.ref;

    expect(afterRef).not.toBe(beforeRef);

    const reconciled = StructuralTree.reconcile(before, after);

    expect(reconciled.root.ref).toBe(beforeRef);
    expect(reconciled.getBeforeNodeForAfterRef(afterRef)?.ref).toBe(beforeRef);
  });

  it("reconciles a unique same-parent re-ref as one updated node with accessible before-state", () => {
    const factory = new SyntheticAriaRefFactory();
    const before = StructuralTree.fromAriaSnapshotYaml(BEFORE, factory);
    const after = StructuralTree.fromAriaSnapshotYaml(AFTER, factory);

    const reconciled = StructuralTree.reconcile(before, after);
    const updated = reconciled.getNode(ref("e4"))!;

    expect(updated.ref).toBe(ref("e4"));
    expect(updated.status).toEqual({
      kind: "updated",
      selfChanged: true,
      childListChanged: false,
    });
    expect(reconciled.getBeforeNode(updated.ref)?.ref).toBe(ref("e2"));
    expect(reconciled.getBeforeNodeForAfterRef(ref("e4"))?.ref).toBe(ref("e2"));
    expect(reconciled.getNodesByStatus("added")).toEqual([]);
    expect(reconciled.getNodesByStatus("removed")).toEqual([]);
  });

  it("does not let an unchanged parent shortcut swallow a nested child re-ref", () => {
    const [before, after] = parsePair(
      '- generic [ref=e1]:\n  - button "Nested" [ref=e2]',
      '- generic [ref=e1]:\n  - button "Nested" [ref=e5]'
    );
    const reconciled = StructuralTree.reconcile(before, after);
    const child = reconciled.getNode(ref("e5"))!;

    expect(reconciled.root.status).toEqual({ kind: "unchanged" });
    expect(child.ref).toBe(ref("e5"));
    expect(child.status).toEqual({ kind: "unchanged" });
    expect(reconciled.getBeforeNodeForAfterRef(child.ref)?.ref).toBe(ref("e2"));
  });

  it("reconciles a nested child re-ref inside a stable-ref moved node", () => {
    const [before, after] = parsePair(
      `
- generic [ref=e1]:
  - group "Moved" [ref=e2]:
    - button "Nested" [ref=e3]
`.trim(),
      `
- generic [ref=e1]:
  - generic:
    - group "Moved" [ref=e2]:
      - button "Nested" [ref=e5]
`.trim()
    );
    const reconciled = StructuralTree.reconcile(before, after);
    const moved = reconciled.getNode(ref("e2"))!;
    const child = reconciled.getNode(ref("e5"))!;

    expect(moved.status).toEqual({ kind: "unchanged" });
    expect(child.ref).toBe(ref("e5"));
    expect(child.status).toEqual({ kind: "unchanged" });
    expect(reconciled.getBeforeNodeForAfterRef(child.ref)?.ref).toBe(ref("e3"));
  });

  it("keeps one-before/two-after changed-ref candidates as additions and removals", () => {
    const [before, after] = parsePair(
      `
- generic [ref=e1]:
  - button "Duplicate" [ref=e2]
`.trim(),
      `
- generic [ref=e1]:
  - button "Duplicate" [disabled] [ref=e4]
  - button "Duplicate" [disabled] [ref=e5]
`.trim()
    );

    const reconciled = StructuralTree.reconcile(before, after);

    expect(
      reconciled.getNodesByStatus("added").map((node) => node.ref)
    ).toEqual(["e4", "e5"]);
    expect(
      reconciled.getNodesByStatus("removed").map((node) => node.ref)
    ).toEqual(["e2"]);
    expect(reconciled.wasBeforeRefAmbiguous(ref("e2"))).toBe(true);
  });

  it("does not report an ordinary unmatched removal as ambiguous", () => {
    const [before, after] = parsePair(
      '- generic [ref=e1]:\n  - button "Old" [ref=e2]',
      "- generic [ref=e1]"
    );

    const reconciled = StructuralTree.reconcile(before, after);

    expect(reconciled.wasBeforeRefAmbiguous(ref("e2"))).toBe(false);
  });

  it("treats exact ref as authoritative when a role change collides with a heuristic candidate", () => {
    const [before, after] = parsePair(
      `
- generic [ref=e1]:
  - button "Submit" [ref=e2]
  - link "Elsewhere" [ref=e3]
`.trim(),
      `
- generic [ref=e1]:
  - link "Submit" [ref=e2]
  - button "Submit" [ref=e5]
`.trim()
    );
    const beforeId = before.getNode(ref("e2"))!.ref;

    const reconciled = StructuralTree.reconcile(before, after);
    const roleChanged = reconciled.getNode(ref("e2"))!;

    expect(roleChanged.ref).toBe(beforeId);
    expect(roleChanged.status).toEqual({
      kind: "updated",
      selfChanged: true,
      childListChanged: false,
    });
    expect(reconciled.getNode(ref("e5"))?.status).toEqual({ kind: "added" });
    expect(reconciled.getBeforeNode(beforeId)?.role).toBe("button");
  });

  it("keeps a changed-ref cross-parent move as add/remove", () => {
    const [before, after] = parsePair(
      `
- generic [ref=e1]:
  - group "Before" [ref=e2]:
    - button "Move" [ref=e3]
  - group "After" [ref=e4]
`.trim(),
      `
- generic [ref=e1]:
  - group "Before" [ref=e2]
  - group "After" [ref=e4]:
    - button "Move" [ref=e5]
`.trim()
    );

    const reconciled = StructuralTree.reconcile(before, after);

    expect(reconciled.getNode(ref("e3"))?.status).toEqual({ kind: "removed" });
    expect(reconciled.getNode(ref("e5"))?.status).toEqual({ kind: "added" });
  });
});

it.each([false, true])(
  "reserves a moved node's ref before matching its replacement, reversed=%s",
  (reversed) => {
    const groups = (moved: boolean) => {
      const a =
        '- group "A" [ref=a]:\n  - button "Save" [ref=' +
        (moved ? "e2" : "e1") +
        "]";
      const b =
        '- group "B" [ref=b]' + (moved ? ':\n  - button "Save" [ref=e1]' : "");
      return (reversed ? [b, a] : [a, b]).join("\n");
    };
    const before = parse(groups(false));
    const change = StructuralTree.reconcile(before, parse(groups(true)));
    expect(change.getBeforeNodeForAfterRef(ref("e1"))).toBe(
      before.getNode(ref("e1"))
    );
    expect(change.getBeforeNodeForAfterRef(ref("e2"))).toBeNull();
    expect(change.getNode(ref("e2"))?.status).toEqual({ kind: "added" });
    expect(change.getNodesByStatus("removed")).toEqual([]);
  }
);

it("keeps descendant lineage when copying an unchanged subtree", () => {
  const yaml =
    '- group "Outer" [ref=e1]:\n  - group "Inner" [ref=e2]:\n    - button "Save" [ref=e3]';
  const before = parse(yaml);
  const change = StructuralTree.reconcile(before, parse(yaml));
  for (const node of before.getAllNodes()) {
    expect(change.getBeforeNodeForAfterRef(node.ref)).toBe(node);
    expect(change.getNode(node.ref)?.status).toEqual({ kind: "unchanged" });
  }
});

it("keeps a moved node authoritative over an identical destination sibling", () => {
  const before = parse(
    '- group "A" [ref=a]:\n  - button "Save" [ref=e1]\n- group "B" [ref=b]:\n  - button "Save" [ref=e2]'
  );
  const after = parse(
    '- group "A" [ref=a]\n- group "B" [ref=b]:\n  - button "Save" [ref=e1]'
  );
  const change = StructuralTree.reconcile(before, after);
  expect(change.getBeforeNodeForAfterRef(ref("e1"))).toBe(
    before.getNode(ref("e1"))
  );
  expect(change.getNode(ref("e2"))?.status).toEqual({ kind: "removed" });
  expect(change.getNodesByStatus("added")).toEqual([]);
});
