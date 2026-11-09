import { describe, expect, it } from "vitest";
import {
  elementLines,
  MAX_CHILD_LINES,
  renderPomScreen,
  renderScreenChanges,
  type ScreenObject,
} from "./pomScreenText";

const editor = (name: string, cards: ScreenObject[]): ScreenObject => ({
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

const card = (ref: string, text: string): ScreenObject => ({
  className: "QuestionCard",
  ref,
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
});

describe("renderPomScreen", () => {
  it("nests instances and shows an empty collection as []", () => {
    expect(
      renderPomScreen([editor("Draft", [card("po1", "Why?")]), editor("X", [])])
    ).toBe(
      [
        "SurveyEditorPage",
        '  surveyName: textbox "Survey name": Draft',
        "  questions:",
        "    - QuestionCard [ref=po1]",
        '        headline: textbox "Question": Why?',
        "SurveyEditorPage",
        '  surveyName: textbox "Survey name": X',
        "  questions: []",
      ].join("\n")
    );
  });

  it("says when no Page Object is on the page", () => {
    expect(renderPomScreen([])).toBe("No Page Object is on the page.");
  });
});

describe("renderScreenChanges", () => {
  it("is absent when nothing changed", () => {
    const screen = [editor("Draft", [card("po1", "Why?")])];
    expect(renderScreenChanges(screen, screen)).toBeUndefined();
  });

  it("shows a changed value as old → new, keeping the role and name once", () => {
    expect(
      renderScreenChanges([editor("Draft", [])], [editor("Final", [])])
    ).toBe(
      [
        "SurveyEditorPage",
        '  surveyName: textbox "Survey name": Draft → Final',
      ].join("\n")
    );
  });

  it('shows a changed state as the whole line old → new, and an empty value as ""', () => {
    const required = (line: string): ScreenObject => ({
      className: "Card",
      children: [{ kind: "elements", name: "required", lines: [line] }],
    });
    expect(
      renderScreenChanges(
        [required('switch "Required"')],
        [required('switch "Required" [checked]')]
      )
    ).toBe('Card\n  required: switch "Required" → switch "Required" [checked]');
    expect(
      renderScreenChanges(
        [required('textbox "Name"')],
        [required('textbox "Name": Ada')]
      )
    ).toBe('Card\n  required: textbox "Name": "" → Ada');
  });

  it("shows a multi-line child's changed lines only", () => {
    const options = (lines: string[]): ScreenObject => ({
      className: "Card",
      children: [{ kind: "elements", name: "options", lines }],
    });
    expect(
      renderScreenChanges(
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

  it("marks a removed instance by its ref and shows an added one in full", () => {
    expect(
      renderScreenChanges(
        [editor("Draft", [card("po1", "Why?"), card("po2", "Age?")])],
        [editor("Draft", [card("po2", "Age?"), card("po3", "Else?")])]
      )
    ).toBe(
      [
        "SurveyEditorPage",
        "  questions:",
        "    - QuestionCard [ref=po1] (removed)",
        "    + QuestionCard [ref=po3]",
        '        headline: textbox "Question": Else?',
      ].join("\n")
    );
  });

  it("keeps a removed instance's first child when it has no ref", () => {
    const item = (text: string): ScreenObject => ({
      className: "Row",
      children: [{ kind: "elements", name: "name", lines: [`cell: ${text}`] }],
    });
    const list = (rows: ScreenObject[]): ScreenObject => ({
      className: "ListPage",
      children: [{ kind: "objects", name: "rows", objects: rows }],
    });
    expect(
      renderScreenChanges([list([item("a"), item("b")])], [list([item("a")])])
    ).toBe("ListPage\n  rows:\n    - Row (removed), was: name: cell: b");
  });

  it("replaces a screen's root Page Object as removed, then added in full", () => {
    const summary: ScreenObject = {
      className: "SurveySummaryPage",
      children: [
        {
          kind: "elements",
          name: "title",
          lines: ['heading "Draft" [level=1]'],
        },
      ],
    };
    expect(renderScreenChanges([editor("Draft", [])], [summary])).toBe(
      [
        "- SurveyEditorPage (removed)",
        "+ SurveySummaryPage",
        '    title: heading "Draft" [level=1]',
      ].join("\n")
    );
  });

  it("marks a child that appeared with + and one that went with (removed)", () => {
    const page = (children: ScreenObject["children"]): ScreenObject => ({
      className: "Page",
      children,
    });
    expect(
      renderScreenChanges(
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
              object: { className: "Dialog", ref: "po4", children: [] },
            },
          ]),
        ]
      )
    ).toBe(
      [
        "Page",
        '  error: alert: "Required" (removed)',
        "  + dialog: Dialog [ref=po4]",
      ].join("\n")
    );
  });
});
