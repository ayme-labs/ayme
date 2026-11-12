import { describe, expect, it } from "vitest";
import { pageObjectIdOf } from "./pageObjectId";
import {
  elementLines,
  MAX_CHILD_LINES,
  renderPageObjectTree,
  renderPageObjectTreeChanges,
  type PageObjectTreeNode,
} from "./pageObjectTreeText";

const editor = (
  name: string,
  cards: PageObjectTreeNode[]
): PageObjectTreeNode => ({
  className: "SurveyEditorPage",
  children: [
    {
      kind: "elements",
      name: "surveyName",
      lines: [`textbox "Survey name": ${name}`],
    },
    { kind: "objects", name: "questions", objects: cards },
  ],
});

const card = (n: number, text: string): PageObjectTreeNode => ({
  className: "QuestionCard",
  id: pageObjectIdOf(n),
  children: [
    {
      kind: "elements",
      name: "headline",
      lines: [`textbox "Question": ${text}`],
    },
  ],
});

describe("elementLines", () => {
  it("puts one element's first line after the child's name and the rest below it", () => {
    expect(
      elementLines(
        ['- list "Options":\n  - listitem: A\n  - listitem: B'],
        false
      )
    ).toEqual(['list "Options":', "- listitem: A", "- listitem: B"]);
  });

  it("lists a collection's elements, [] for none, and leaves out a child that matches nothing", () => {
    expect(elementLines(['- row "a"', '- row "b"'], true)).toEqual([
      "",
      '- row "a"',
      '- row "b"',
    ]);
    expect(elementLines([], true)).toEqual(["[]"]);
    expect(elementLines([""], false)).toBeUndefined();
  });

  it("cuts a long subtree and says how many lines it left out", () => {
    const snapshot = [
      "- list:",
      ...Array.from({ length: 50 }, (_, index) => `  - listitem: ${index}`),
    ].join("\n");
    const lines = elementLines([snapshot], false)!;
    expect(lines).toHaveLength(MAX_CHILD_LINES + 1);
    expect(lines.at(-1)).toBe("- (11 more lines not shown)");
  });

  it("shortens a very long line", () => {
    const [line] = elementLines([`- text: ${"x".repeat(300)}`], false)!;
    expect(line).toHaveLength(200);
    expect(line!.endsWith("…")).toBe(true);
  });
});

describe("renderPageObjectTree", () => {
  it("nests Page Objects, shows each id beside its class, and an empty collection as []", () => {
    expect(
      renderPageObjectTree([
        editor("Onboarding", [card(1, "Why?"), card(2, "How?")]),
        editor("Churn", []),
      ])
    ).toBe(
      [
        "SurveyEditorPage",
        '  surveyName: textbox "Survey name": Onboarding',
        "  questions:",
        "    - QuestionCard po1",
        '        headline: textbox "Question": Why?',
        "    - QuestionCard po2",
        '        headline: textbox "Question": How?',
        "SurveyEditorPage",
        '  surveyName: textbox "Survey name": Churn',
        "  questions: []",
      ].join("\n")
    );
  });

  it("shows a single child Page Object after its name, with its own children below", () => {
    expect(
      renderPageObjectTree([
        {
          className: "ListPage",
          children: [
            {
              kind: "object",
              name: "archiveDialog",
              object: {
                className: "ArchiveDialog",
                id: pageObjectIdOf(3),
                children: [
                  {
                    kind: "elements",
                    name: "message",
                    lines: ["", '- paragraph: Archive "Milk"?'],
                  },
                ],
              },
            },
          ],
        },
      ])
    ).toBe(
      [
        "ListPage",
        "  archiveDialog: ArchiveDialog po3",
        "    message:",
        '      - paragraph: Archive "Milk"?',
      ].join("\n")
    );
  });

  it("says when no Page Object is on the page", () => {
    expect(renderPageObjectTree([])).toBe("No Page Object is on the page.");
  });
});

describe("renderPageObjectTreeChanges", () => {
  it("is absent when nothing changed", () => {
    const tree = [editor("Draft", [card(1, "Why?")])];
    expect(renderPageObjectTreeChanges(tree, tree)).toBeUndefined();
  });

  it("shows a changed value as old → new, keeping the role and name once", () => {
    expect(
      renderPageObjectTreeChanges([editor("Draft", [])], [editor("Final", [])])
    ).toBe(
      [
        "SurveyEditorPage",
        '  surveyName: textbox "Survey name": Draft → Final',
      ].join("\n")
    );
  });

  it('shows a changed state as the whole line old → new, and an empty value as ""', () => {
    const required = (line: string): PageObjectTreeNode => ({
      className: "Card",
      children: [{ kind: "elements", name: "required", lines: [line] }],
    });
    expect(
      renderPageObjectTreeChanges(
        [required('switch "Required"')],
        [required('switch "Required" [checked]')]
      )
    ).toBe('Card\n  required: switch "Required" → switch "Required" [checked]');
    expect(
      renderPageObjectTreeChanges(
        [required('textbox "Name"')],
        [required('textbox "Name": Ada')]
      )
    ).toBe('Card\n  required: textbox "Name": "" → Ada');
  });

  it("shows a multi-line child's changed lines only", () => {
    const options = (lines: string[]): PageObjectTreeNode => ({
      className: "Card",
      children: [{ kind: "elements", name: "options", lines }],
    });
    expect(
      renderPageObjectTreeChanges(
        [options(["list:", "- listitem: A", "- listitem: B", "- listitem: C"])],
        [
          options([
            "list:",
            "- listitem: A",
            "- listitem: B2",
            "- listitem: D",
            "- listitem: E",
          ]),
        ]
      )
    ).toBe(
      [
        "Card",
        "  options:",
        "    - listitem: B → - listitem: B2",
        "    - listitem: C → - listitem: D",
        "    + - listitem: E",
      ].join("\n")
    );
  });

  it("marks a Page Object that went away by its id, and shows one that appeared in full, with its children and id", () => {
    expect(
      renderPageObjectTreeChanges(
        [editor("Draft", [card(1, "Why?"), card(2, "Age?")])],
        [editor("Draft", [card(2, "Age?"), card(3, "Else?")])]
      )
    ).toBe(
      [
        "SurveyEditorPage",
        "  questions:",
        "    - QuestionCard po1 (removed)",
        "    + QuestionCard po3",
        '        headline: textbox "Question": Else?',
      ].join("\n")
    );
  });

  it("keeps the first child of a Page Object without an id that went away", () => {
    const item = (text: string): PageObjectTreeNode => ({
      className: "Row",
      children: [{ kind: "elements", name: "name", lines: [`cell: ${text}`] }],
    });
    const list = (rows: PageObjectTreeNode[]): PageObjectTreeNode => ({
      className: "ListPage",
      children: [{ kind: "objects", name: "rows", objects: rows }],
    });
    expect(
      renderPageObjectTreeChanges(
        [list([item("a"), item("b")])],
        [list([item("a")])]
      )
    ).toBe("ListPage\n  rows:\n    - Row (removed), was: name: cell: b");
  });

  it("shows a page's top Page Object that was replaced as removed, then added in full", () => {
    const summary: PageObjectTreeNode = {
      className: "SurveySummaryPage",
      children: [
        {
          kind: "elements",
          name: "title",
          lines: ['heading "Draft" [level=1]'],
        },
      ],
    };
    expect(renderPageObjectTreeChanges([editor("Draft", [])], [summary])).toBe(
      [
        "- SurveyEditorPage (removed)",
        "+ SurveySummaryPage",
        '    title: heading "Draft" [level=1]',
      ].join("\n")
    );
  });

  it("marks a child that appeared with + and one that went away with (removed)", () => {
    const page = (
      children: PageObjectTreeNode["children"]
    ): PageObjectTreeNode => ({ className: "Page", children });
    expect(
      renderPageObjectTreeChanges(
        [
          page([
            { kind: "elements", name: "error", lines: ['alert: "Required"'] },
          ]),
        ],
        [
          page([
            {
              kind: "object",
              name: "dialog",
              object: {
                className: "Dialog",
                id: pageObjectIdOf(4),
                children: [],
              },
            },
          ]),
        ]
      )
    ).toBe(
      [
        "Page",
        '  error: alert: "Required" (removed)',
        "  + dialog: Dialog po4",
      ].join("\n")
    );
  });

  it("names no tool and carries no schema or Structural Ref", () => {
    const text = renderPageObjectTreeChanges(
      [editor("Draft", [card(1, "Why?")])],
      [editor("Draft", [card(1, "Why?"), card(2, "Age?")])]
    )!;
    expect(text).not.toMatch(/QuestionCard\.|"type"|inputSchema|\be\d+\b/);
  });
});
