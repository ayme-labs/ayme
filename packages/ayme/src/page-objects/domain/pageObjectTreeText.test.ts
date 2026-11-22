import { describe, expect, it } from "vitest";
import {
  StructuralTree,
  SyntheticAriaRefFactory,
  type AriaRef,
} from "@ayme-dev/core/structural-observation";
import { treeRead } from "../../test-utils/pageObjectTree.testSupport";
import { elementText } from "./elementText";
import { pageObjectIdOf } from "./pageObjectId";
import {
  elementLines,
  MAX_CHILD_LINES,
  renderPageObjectTree,
  renderPageObjectTreeChanges,
} from "./pageObjectTreeText";

/**
 * A survey editor named `name` with a question card for each of
 * `questions`, by its id's number and its text: each element is named by a
 * ref of its own, the same in every read.
 */
const editor = (name: string, questions: [number, string][]) =>
  treeRead(
    [
      `- textbox "Survey name" [ref=e1]: ${name}`,
      ...questions.map(
        ([n, text]) => `- textbox "Question" [ref=e${10 + n}]: ${text}`
      ),
    ].join("\n"),
    (elements) => [
      {
        className: "SurveyEditorPage",
        children: [
          elements("surveyName", "e1"),
          {
            kind: "objects",
            name: "questions",
            objects: questions.map(([n]) => ({
              className: "QuestionCard",
              id: pageObjectIdOf(n),
              children: [elements("headline", `e${10 + n}`)],
            })),
          },
        ],
      },
    ]
  );

/** A Page Object `Card` whose child `name` is the element `line` writes, as `e1`. */
const cardWith = (name: string, line: string) =>
  treeRead(
    `- ${line.replace(/^(\S+(?: "[^"]*")?(?: \[[^\]]*\])*)/, "$1 [ref=e1]")}`,
    (elements) => [{ className: "Card", children: [elements(name, "e1")] }]
  );

describe("elementText", () => {
  const tree = (yaml: string) =>
    StructuralTree.fromAriaSnapshotYaml(yaml, new SyntheticAriaRefFactory());

  it("is the element's subtree in the page state's notation, without refs", () => {
    expect(
      elementText(
        tree(
          '- list "Options" [ref=e1]:\n  - listitem [ref=e2]: A\n  - link "Docs" [ref=e3]:\n    - /url: /docs'
        ),
        "e1" as AriaRef
      )
    ).toBe(
      '- list "Options":\n  - listitem: A\n  - link "Docs":\n    - /url: /docs'
    );
  });

  it("shows an unnamed generic's content in its place, as Playwright's aria snapshot does", () => {
    expect(
      elementText(
        tree(
          '- generic [ref=e1]:\n  - generic [ref=e2]: Milk\n  - button "Remove" [ref=e3]'
        ),
        "e1" as AriaRef
      )
    ).toBe('- text: Milk\n- button "Remove"');
  });

  it("is empty for an element the capture does not hold", () => {
    expect(elementText(tree("- button [ref=e1]"), "e9" as AriaRef)).toBe("");
  });
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
    const onboarding = editor("Onboarding", [
      [1, "Why"],
      [2, "How"],
    ]);
    expect(
      renderPageObjectTree([
        ...onboarding.objects,
        {
          className: "SurveyEditorPage",
          children: [{ kind: "objects", name: "questions", objects: [] }],
        },
      ])
    ).toBe(
      [
        "SurveyEditorPage",
        '  surveyName: textbox "Survey name": Onboarding',
        "  questions:",
        "    - QuestionCard po1",
        '        headline: textbox "Question": Why',
        "    - QuestionCard po2",
        '        headline: textbox "Question": How',
        "SurveyEditorPage",
        "  questions: []",
      ].join("\n")
    );
  });

  it("shows a single child Page Object after its name, with its own children below", () => {
    const { objects } = treeRead(
      '- dialog [ref=e1]:\n  - paragraph [ref=e2]: Archive "Milk"?',
      (elements) => [
        {
          className: "ListPage",
          children: [
            {
              kind: "object",
              name: "archiveDialog",
              object: {
                className: "ArchiveDialog",
                id: pageObjectIdOf(3),
                children: [elements("message", ["e2"])],
              },
            },
          ],
        },
      ]
    );
    expect(renderPageObjectTree(objects)).toBe(
      [
        "ListPage",
        "  archiveDialog: ArchiveDialog po3",
        "    message:",
        '      - paragraph: "Archive \\"Milk\\"?"',
      ].join("\n")
    );
  });

  it("leaves out a single element child that is not on the page, and shows an empty collection as []", () => {
    const { objects } = treeRead('- button "Add" [ref=e1]', (elements) => [
      {
        className: "ListPage",
        children: [elements("error", "e9"), elements("rows", [])],
      },
    ]);
    expect(renderPageObjectTree(objects)).toBe("ListPage\n  rows: []");
  });

  it("says when no Page Object is on the page", () => {
    expect(renderPageObjectTree([])).toBe("No Page Object is on the page.");
  });
});

describe("renderPageObjectTreeChanges", () => {
  it("is absent when nothing changed", () => {
    const read = editor("Draft", [[1, "Why"]]);
    expect(renderPageObjectTreeChanges(read, read)).toBeUndefined();
  });

  it("shows a changed value as old → new, keeping the role and name once", () => {
    expect(
      renderPageObjectTreeChanges(editor("Draft", []), editor("Final", []))
    ).toBe(
      [
        "SurveyEditorPage",
        '  surveyName: textbox "Survey name": Draft → Final',
      ].join("\n")
    );
  });

  it('shows a changed state as the whole line old → new, and an empty value as ""', () => {
    expect(
      renderPageObjectTreeChanges(
        cardWith("required", 'switch "Required"'),
        cardWith("required", 'switch "Required" [checked]')
      )
    ).toBe('Card\n  required: switch "Required" → switch "Required" [checked]');
    expect(
      renderPageObjectTreeChanges(
        cardWith("name", 'textbox "Name"'),
        cardWith("name", 'textbox "Name": Ada')
      )
    ).toBe('Card\n  name: textbox "Name": "" → Ada');
  });

  it("shows an unnamed generic's changed text as its text", () => {
    const count = (n: number) =>
      treeRead(`- generic [ref=e1]: ${n}`, (elements) => [
        { className: "Counter", children: [elements("count", "e1")] },
      ]);
    expect(renderPageObjectTreeChanges(count(3), count(4))).toBe(
      "Counter\n  count: text: 3 → 4"
    );
  });

  it("compares the text of a span of text the capture kept as a node", () => {
    const named = (text: string) =>
      treeRead(
        `- listitem [ref=e1]:\n  - generic [ref=e2]: ${text}`,
        (elements) => [
          { className: "Item", children: [elements("name", "e2")] },
        ]
      );
    expect(
      renderPageObjectTreeChanges(named("Milk"), named("Milk"))
    ).toBeUndefined();
    expect(renderPageObjectTreeChanges(named("Milk"), named("Oat milk"))).toBe(
      "Item\n  name: text: Milk → Oat milk"
    );
  });

  /** A Card whose `options` list holds `items`, each by its ref and text. */
  const options = (items: [string, string][]) =>
    treeRead(
      [
        '- list "Options" [ref=e1]:',
        ...items.map(([ref, text]) => `  - listitem [ref=${ref}]: ${text}`),
      ].join("\n"),
      (elements) => [
        { className: "Card", children: [elements("options", "e1")] },
      ]
    );

  it("shows only what changed inside an element, each item by its own identity", () => {
    expect(
      renderPageObjectTreeChanges(
        options([
          ["e2", "A"],
          ["e3", "B"],
          ["e4", "C"],
        ]),
        options([
          ["e2", "A"],
          ["e3", "B2"],
          ["e5", "D"],
        ])
      )
    ).toBe(
      [
        "Card",
        "  options:",
        "    - listitem: B → B2",
        "    + - listitem: D",
        "    - listitem: C (removed)",
      ].join("\n")
    );
  });

  it("reads an item that took another's old text as changed, not as moved", () => {
    expect(
      renderPageObjectTreeChanges(
        options([
          ["e2", "A"],
          ["e3", "B"],
        ]),
        options([
          ["e2", "B"],
          ["e3", "C"],
        ])
      )
    ).toBe(
      [
        "Card",
        "  options:",
        "    - listitem: A → B",
        "    - listitem: B → C",
      ].join("\n")
    );
  });

  it("marks an element that left a collection child (removed), and one that joined it in full after +", () => {
    const rows = (refs: string[]) =>
      treeRead(
        '- row "a" [ref=e1]\n- row "b" [ref=e2]\n- row "c" [ref=e3]',
        (elements) => [
          { className: "Table", children: [elements("selected", refs)] },
        ]
      );
    expect(
      renderPageObjectTreeChanges(rows(["e1", "e2"]), rows(["e2", "e3"]))
    ).toBe(
      [
        "Table",
        "  selected:",
        '    - row "a" (removed)',
        '    + - row "c"',
      ].join("\n")
    );
  });

  it("marks a Page Object that went away by its id, and shows one that appeared in full, with its children and id", () => {
    expect(
      renderPageObjectTreeChanges(
        editor("Draft", [
          [1, "Why"],
          [2, "Age"],
        ]),
        editor("Draft", [
          [2, "Age"],
          [3, "Else"],
        ])
      )
    ).toBe(
      [
        "SurveyEditorPage",
        "  questions:",
        "    - QuestionCard po1 (removed)",
        "    + QuestionCard po3",
        '        headline: textbox "Question": Else',
      ].join("\n")
    );
  });

  it("keeps the first child of a Page Object without an id that went away", () => {
    const list = (texts: string[]) =>
      treeRead(
        texts.map((text, at) => `- cell [ref=e${at + 1}]: ${text}`).join("\n"),
        (elements) => [
          {
            className: "ListPage",
            children: [
              {
                kind: "objects",
                name: "rows",
                objects: texts.map((_, at) => ({
                  className: "Row",
                  children: [elements("name", `e${at + 1}`)],
                })),
              },
            ],
          },
        ]
      );
    expect(renderPageObjectTreeChanges(list(["a", "b"]), list(["a"]))).toBe(
      "ListPage\n  rows:\n    - Row (removed), was: name: cell: b"
    );
  });

  it("shows a page's top Page Object that was replaced as removed, then added in full", () => {
    const summary = treeRead(
      '- heading "Draft" [level=1] [ref=e5]',
      (elements) => [
        { className: "SurveySummaryPage", children: [elements("title", "e5")] },
      ]
    );
    expect(renderPageObjectTreeChanges(editor("Draft", []), summary)).toBe(
      [
        "- SurveyEditorPage (removed)",
        "+ SurveySummaryPage",
        '    title: heading "Draft" [level=1]',
      ].join("\n")
    );
  });

  it("marks a child that appeared with + and one that went away with (removed)", () => {
    const before = treeRead("- alert [ref=e1]: Required", (elements) => [
      { className: "Page", children: [elements("error", "e1")] },
    ]);
    const after = treeRead("- dialog [ref=e2]", () => [
      {
        className: "Page",
        children: [
          {
            kind: "object",
            name: "dialog",
            object: {
              className: "Dialog",
              id: pageObjectIdOf(4),
              children: [],
            },
          },
        ],
      },
    ]);
    expect(renderPageObjectTreeChanges(before, after)).toBe(
      [
        "Page",
        "  error: alert: Required (removed)",
        "  + dialog: Dialog po4",
      ].join("\n")
    );
  });

  it("names no tool and carries no schema or Structural Ref", () => {
    const text = renderPageObjectTreeChanges(
      editor("Draft", [[1, "Why"]]),
      editor("Draft", [
        [1, "Why not"],
        [2, "Age"],
      ])
    )!;
    expect(text).not.toMatch(/QuestionCard\.|"type"|inputSchema|\be\d+\b/);
  });
});
