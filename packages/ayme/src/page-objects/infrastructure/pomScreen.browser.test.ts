import { afterEach, describe, expect, it, vi } from "vitest";

import { createPage } from "./browserPage";
import { rooted } from "../../test-utils/pomRoot.testSupport";
import { browserRegistry, registerCompiledPom } from "./registry";
import { renderPomScreen, renderScreenChanges } from "../domain";
import { RefResolutionError, type PomManifest } from "../../shared";
import { runContext } from "../../test-utils/agentCalls.testSupport";
import { startSession } from "../../test-utils/session.testSupport";

const manifest: PomManifest = {
  className: "EditorPage",
  tools: [],
  members: [
    { memberName: "title", kind: "locator", access: "field" },
    { memberName: "surveyName", kind: "locator", access: "field" },
    { memberName: "missing", kind: "locator", access: "field" },
    {
      memberName: "questions",
      kind: "component",
      access: "getter",
      componentClassName: "QuestionCard",
      collection: true,
    },
    {
      memberName: "dialogs",
      kind: "component",
      access: "getter",
      componentClassName: "Dialog",
      collection: true,
    },
  ],
  components: [
    {
      className: "QuestionCard",
      members: [
        { memberName: "root", kind: "locator", access: "field" },
        { memberName: "headline", kind: "locator", access: "field" },
        { memberName: "required", kind: "locator", access: "field" },
      ],
      tools: [
        {
          methodName: "remove",
          toolName: "QuestionCard.remove",
          description: "Remove this question.",
          parameters: [],
          returnPoms: [],
        },
      ],
    },
    {
      className: "Dialog",
      members: [{ memberName: "root", kind: "locator", access: "field" }],
      tools: [],
    },
  ],
};

/** The po refs the screen shows, in its order. */
const poRefs = (text: string) =>
  [...text.matchAll(/\[ref=(po\d+)\]/g)].map(([, ref]) => ref!);

const card = (id: string, text: string, checked: boolean) => `
  <section id="${id}">
    <label>Question <input value="${text}"></label>
    <label><input type="checkbox" role="switch" ${checked ? "checked" : ""}> Required</label>
  </section>`;

describe("the Page Object Screen", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  function setUp() {
    document.body.innerHTML = `
      <h1>Edit survey</h1>
      <label>Survey name <input value="Onboarding"></label>
      <main>${card("q1", "Why here?", true)}${card("q2", "How old?", false)}</main>`;
    const page = createPage({ actionTimeout: 500 });
    const session = startSession(page);
    const removed: string[] = [];
    class EditorPage {
      readonly title = page.getByRole("heading", { level: 1 });
      readonly surveyName = page.getByRole("textbox", { name: "Survey name" });
      readonly missing = page.getByRole("button", { name: "Nowhere" });
      get questions() {
        return [...document.querySelectorAll("section")].map((section) => {
          const root = page.locator(`#${section.id}`);
          return rooted(root, {
            headline: root.getByRole("textbox"),
            required: root.getByRole("switch"),
            remove: () => {
              removed.push(section.id);
              section.remove();
            },
          });
        });
      }
      get dialogs() {
        return [rooted(page.locator("dialog"), {})];
      }
    }
    registerCompiledPom(EditorPage, manifest);
    session.register(EditorPage);
    return { session, removed };
  }

  it("shows each instance nested, its children as aria subtrees, rooted ones with po refs", async () => {
    const { session } = setUp();
    try {
      const screen = await browserRegistry().readRegisteredPomScreen();
      // Refs are minted per document, so earlier tests' instances took some.
      const [first, second] = poRefs(renderPomScreen(screen));
      expect(Number(second!.slice(2))).toBe(Number(first!.slice(2)) + 1);
      expect(renderPomScreen(screen)).toBe(
        [
          "EditorPage",
          '  title: heading "Edit survey" [level=1]',
          '  surveyName: textbox "Survey name": Onboarding',
          "  questions:",
          `    - QuestionCard [ref=${first}]`,
          '        headline: textbox "Question": Why here?',
          '        required: switch "Required" [checked]',
          `    - QuestionCard [ref=${second}]`,
          '        headline: textbox "Question": How old?',
          '        required: switch "Required"',
          "  dialogs: []",
        ].join("\n")
      );
      expect(renderPomScreen(screen)).not.toMatch(/\be\d+\b/);
    } finally {
      session.stop();
    }
  });

  it("keeps an instance's po ref while it stays, and mints a new one for a new instance", async () => {
    const { session } = setUp();
    try {
      const registry = browserRegistry();
      const before = await registry.readRegisteredPomScreen();
      const [first, second] = poRefs(renderPomScreen(before));
      const next = `po${Number(second!.slice(2)) + 1}`;
      document.querySelector("#q1")!.remove();
      document
        .querySelector("main")!
        .insertAdjacentHTML("beforeend", card("q3", "Anything else?", false));
      (document.querySelector("#q2 input") as HTMLInputElement).value =
        "How old are you?";
      const after = await registry.readRegisteredPomScreen();
      expect(renderScreenChanges(before, after)).toBe(
        [
          "EditorPage",
          "  questions:",
          `    - QuestionCard [ref=${first}] (removed)`,
          `    - QuestionCard [ref=${second}]`,
          '        headline: textbox "Question": How old? → How old are you?',
          `    + QuestionCard [ref=${next}]`,
          '        headline: textbox "Question": Anything else?',
          '        required: switch "Required"',
        ].join("\n")
      );
    } finally {
      session.stop();
    }
  });

  it("runs a rooted tool on the instance its po ref names, and refuses a ref no instance has", async () => {
    const { session, removed } = setUp();
    try {
      const registry = browserRegistry();
      const [, second] = poRefs(
        renderPomScreen(await registry.readRegisteredPomScreen())
      );
      const tool = registry
        .listRegisteredPomTools()
        .find(({ tool }) => tool.name === "QuestionCard.remove")!.tool;

      await tool.execute({ ref: second }, runContext());
      expect(removed).toEqual(["q2"]);

      const refused = vi.fn();
      await tool.execute({ ref: second }, runContext()).catch(refused);
      await tool.execute({ ref: "po999" }, runContext()).catch(refused);
      expect(refused).toHaveBeenCalledTimes(2);
      for (const [error] of refused.mock.calls)
        expect(error).toBeInstanceOf(RefResolutionError);
    } finally {
      session.stop();
    }
  });
});
