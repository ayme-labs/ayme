import { describe, expect, it } from "vitest";
import {
  AriaRefSchema,
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
    expect(text).not.toContain("<changed>");
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

  it("marks only content changes; re-identified and child-list-only nodes stay plain", () => {
    const reconciled = reconcile(
      [
        "- region [ref=e1]:",
        '  - heading "My list" [level=2] [ref=e2]',
        "  - list [ref=e3]:",
        "    - listitem [ref=e4]: Apple",
      ].join("\n"),
      [
        "- region [ref=e7]:",
        '  - heading "My list" [level=2] [ref=e5]',
        "  - list [ref=e3]:",
        "    - listitem [ref=e4]: Apple",
        "    - listitem [ref=e6]: Banana",
      ].join("\n")
    );

    expect(reconciled.hasAnyChanges()).toBe(true);
    expect(renderChangeRecord(reconciled)).toBe(
      [
        "- e7 region:",
        "  - e3 list:",
        "    - e6 <added> listitem: Banana",
      ].join("\n")
    );
  });

  it("reports no change when a re-render leaves the content equal", () => {
    const reconciled = reconcile(
      '- region [ref=e1]:\n  - heading "My list" [level=2] [ref=e2]',
      '- region [ref=e3]:\n  - heading "My list" [level=2] [ref=e4]'
    );

    expect(reconciled.hasAnyChanges()).toBe(false);
    expect(renderChangeRecord(reconciled)).toBe("");
  });

  it("does not mark a re-rendered region whose content is unchanged", () => {
    const reconciled = reconcile(
      [
        '- main "Playground" [ref=e1]:',
        '  - region "Demo application" [ref=e2]:',
        "    - generic [ref=e59]:",
        '      - heading "My list" [level=2] [ref=e62]',
        "      - generic [ref=e63]: 2 active",
        '    - form "Add a list item" [ref=e64]:',
        "      - generic [ref=e68]:",
        '        - textbox "New item" [ref=e69]',
        '        - button "Add item" [ref=e70]',
      ].join("\n"),
      [
        '- main "Playground" [ref=e474]:',
        '  - region "Demo application" [ref=e475]:',
        "    - generic [ref=e59]:",
        '      - heading "My list" [level=2] [ref=e476]',
        "      - generic [ref=e63]: 0 active",
        '    - form "Add a list item" [ref=e477]:',
        "      - generic [ref=e68]:",
        '        - textbox "New item" [ref=e478]',
        '        - button "Add item" [ref=e479]',
        "        - alert [ref=e533]: Enter an item name first.",
      ].join("\n")
    );

    expect(renderChangeRecord(reconciled)).toBe(
      [
        '- e474 main "Playground":',
        '  - e475 region "Demo application":',
        "    - e59:",
        "      - e63 <changed>: 0 active",
        '    - e477 form "Add a list item":',
        "      - e68:",
        "        - e533 <added> alert: Enter an item name first.",
      ].join("\n")
    );
  });

  it("returns empty string when there are no changes", () => {
    const reconciled = reconcile(
      '- button "Save" [ref=e1]',
      '- button "Save" [ref=e1]'
    );
    expect(renderChangeRecord(reconciled)).toBe("");
  });

  describe("Page Object Roots", () => {
    const marks = (entries: Record<string, string[]> = {}) =>
      new Map(
        Object.entries(entries).map(
          ([ref, refMarks]) => [AriaRefSchema.parse(ref), refMarks] as const
        )
      );
    const LIST_PAGE = [
      "- main [ref=e3]:",
      '  - heading "Shopping list" [level=1] [ref=e4]',
      "  - list [ref=e9]:",
      "    - listitem [ref=e10]: Milk",
    ].join("\n");

    it("marks a root kept as a path marker with its Page Object's name, role suppressed", () => {
      const reconciled = reconcile(
        LIST_PAGE,
        `${LIST_PAGE}\n    - listitem [ref=e12]: Eggs`
      );

      expect(
        renderChangeRecord(reconciled, {
          before: marks({ e3: ["ListPage"] }),
          after: marks({ e3: ["ListPage"] }),
        })
      ).toBe(
        [
          "- e3 ListPage:",
          "  - e9 list:",
          "    - e12 <added> listitem: Eggs",
        ].join("\n")
      );
    });

    it("marks a removed root by the mark it had before", () => {
      const reconciled = reconcile(
        LIST_PAGE,
        LIST_PAGE.replace("\n    - listitem [ref=e10]: Milk", "")
      );

      expect(
        renderChangeRecord(reconciled, {
          before: marks({ e10: ["ListItem"] }),
          after: marks(),
        })
      ).toBe(
        [
          "- e3 main:",
          "  - e9 list:",
          "    - e10 ListItem <removed>: Milk",
        ].join("\n")
      );
    });

    it("marks a present node by the marks it has after", () => {
      const reconciled = reconcile(
        LIST_PAGE,
        `${LIST_PAGE}\n    - listitem [ref=e12]: Eggs`
      );

      expect(
        renderChangeRecord(reconciled, {
          before: marks({ e3: ["ListPage"] }),
          after: marks({ e12: ["ListItem"] }),
        })
      ).toBe(
        ["- e3 main:", "  - e9 list:", "    - e12 ListItem <added>: Eggs"].join(
          "\n"
        )
      );
    });

    it("marks a synthetic root the reconciled tree keeps under its before ref", () => {
      const reconciled = reconcile(
        "- generic [ref=s_1]:\n  - listitem [ref=e2]: Milk",
        "- generic [ref=s_2]:\n  - listitem [ref=e2]: Eggs"
      );

      expect(
        renderChangeRecord(reconciled, {
          before: marks({ s_1: ["ListItem"] }),
          after: marks({ s_2: ["ListItem"] }),
        })
      ).toBe(["- s_1 ListItem:", "  - e2 <changed> listitem: Eggs"].join("\n"));
    });

    it("shows several marks on one root as the pom property", () => {
      const reconciled = reconcile(
        LIST_PAGE,
        `${LIST_PAGE}\n    - listitem [ref=e12]: Eggs`
      );
      const shared = marks({ e3: ["ListPage", "Cart"] });

      expect(
        renderChangeRecord(reconciled, { before: shared, after: shared })
      ).toBe(
        [
          "- e3 main:",
          '  - /pom: ["Cart","ListPage"]',
          "  - e9 list:",
          "    - e12 <added> listitem: Eggs",
        ].join("\n")
      );
    });
  });
});
