import { describe, expect, it } from "vitest";
import { pageObjectIdOf } from "./pageObjectId";
import {
  elementLines,
  MAX_CHILD_LINES,
  renderPageObjectTree,
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
