import { describe, expect, it } from "vitest";
import {
  StructuralTree,
  SyntheticAriaRefFactory,
} from "@ayme-dev/core/structural-observation";
import { renderChangeRecord } from "./changeRecord";

const factory = () => new SyntheticAriaRefFactory();

function reconcile(beforeYaml: string, afterYaml: string) {
  const f = factory();
  const before = StructuralTree.fromAriaSnapshotYaml(beforeYaml, f);
  const after = StructuralTree.fromAriaSnapshotYaml(afterYaml, f);
  return StructuralTree.reconcile(before, after);
}

describe("renderChangeRecord", () => {
  it("shows an added subtree", () => {
    const reconciled = reconcile(
      '- button "Open" [ref=e1]',
      '- button "Open" [ref=e1]\n- dialog "Confirm" [ref=e2]:\n  - paragraph [ref=e3]: Are you sure?'
    );
    const text = renderChangeRecord(reconciled);
    expect(text).toContain("<added>");
    expect(text).toContain("dialog");
    expect(text).toContain("Confirm");
    expect(text).not.toContain("Open");
  });

  it("shows a removed subtree with path to it", () => {
    const reconciled = reconcile(
      "- list [ref=e1]:\n  - listitem [ref=e2]: Apple\n  - listitem [ref=e3]: Banana",
      "- list [ref=e1]:\n  - listitem [ref=e3]: Banana"
    );
    const text = renderChangeRecord(reconciled);
    expect(text).toContain("<changed>");
    expect(text).toContain("<removed>");
    expect(text).toContain("Apple");
    expect(text).not.toContain("Banana");
  });

  it("shows an updated node", () => {
    const reconciled = reconcile(
      '- button "Save" [ref=e1]',
      '- button "Save changes" [ref=e1]'
    );
    const text = renderChangeRecord(reconciled);
    expect(text).toContain("<changed>");
    expect(text).toContain("Save changes");
  });

  it("shows a deep change with path", () => {
    const reconciled = reconcile(
      '- navigation [ref=e1]:\n  - list [ref=e2]:\n    - listitem [ref=e3]:\n      - link "Home" [ref=e4]',
      '- navigation [ref=e1]:\n  - list [ref=e2]:\n    - listitem [ref=e3]:\n      - link "Dashboard" [ref=e4]'
    );
    const text = renderChangeRecord(reconciled);
    expect(text).toContain("navigation");
    expect(text).toContain("list");
    expect(text).toContain("<changed>");
    expect(text).toContain("Dashboard");
    expect(text).not.toContain("Home");
  });

  it("returns empty string when there are no changes", () => {
    const reconciled = reconcile(
      '- button "Save" [ref=e1]',
      '- button "Save" [ref=e1]'
    );
    expect(renderChangeRecord(reconciled)).toBe("");
  });
});
