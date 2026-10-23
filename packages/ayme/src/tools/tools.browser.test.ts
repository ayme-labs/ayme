import { afterEach, describe, expect, it } from "vitest";
import type { Page } from "@playwright/test";

import {
  createPage,
  probeRegisteredPomMembers,
  registerCompiledPom,
  type PageObjectConstructor,
} from "../page-objects";
import type { PomManifest } from "../shared";
import type { CustomTool } from "./elementTools";
import { AymeError, ToolInputError } from "../shared";
import { buildToolOptions, planArguments } from "../goal-loop";
import { getPomDefinitionText } from "./pageContext";
import {
  getInteractionHistory,
  lookAtPageStateForDocument,
  type AriaRef,
} from "../page-state";
import { rooted } from "../test-utils/pomRoot.testSupport";
import {
  agentTools,
  saveButtonRef,
} from "../test-utils/publication.testSupport";
import {
  createAyme,
  listElementToolTargets,
  listTools,
  type Ayme,
  type PublishedToolGroup,
  type ToolInfo,
} from "../runtime";

// Runtime object seam: the session's tools as `ayme.tools` lists and runs
// them, and the set `@ayme-dev/webmcp` publishes. An agent's call is a
// `webmcp` Run, through the publication harness.

// --- Fixtures: one tool of each kind an agent can be given ---

const pomManifest = (className: string, methodName: string): PomManifest => ({
  className,
  members: [],
  tools: [
    {
      methodName,
      toolName: `${className}.${methodName}`,
      description: `${methodName} on ${className}.`,
      parameters: [
        { name: "title", optional: false, schema: { type: "string" } },
      ],
    },
  ],
  components: [],
});

class TodoPage {
  addTodo() {}
}

class SettingsPage {
  save() {}
}

/** A Page Object whose actions have no description. */
class BarePage {
  open() {}
  close() {}
}

registerCompiledPom(BarePage, {
  className: "BarePage",
  members: [],
  tools: [
    {
      methodName: "open",
      toolName: "BarePage.open",
      parameters: [],
      returnPoms: ["BarePage", "SettingsPage"],
    },
    { methodName: "close", toolName: "BarePage.close", parameters: [] },
  ],
  components: [],
});

/** A Page Object whose action takes a rest parameter. */
class GroupPage {
  static calls: unknown[][] = [];
  toggle(...args: unknown[]) {
    GroupPage.calls.push(args);
  }
}

registerCompiledPom(TodoPage, pomManifest("TodoPage", "addTodo"));
registerCompiledPom(GroupPage, {
  className: "GroupPage",
  members: [],
  tools: [
    {
      methodName: "toggle",
      toolName: "GroupPage.toggle",
      description: "Toggle refs in a group.",
      parameters: [
        { name: "group", optional: false, schema: { type: "number" } },
        {
          name: "refs",
          optional: false,
          schema: { type: "array", items: { type: "string" } },
          rest: true,
        },
      ],
    },
  ],
  components: [],
});
registerCompiledPom(SettingsPage, pomManifest("SettingsPage", "save"));

/**
 * One list item whose archive action makes the item unavailable while the
 * call is still running, as a confirmation dialog opened over it does.
 */
class ListPage {
  readonly items;

  constructor(page: Page) {
    this.items = [
      rooted(page.locator("#item"), {
        async archive() {
          document.querySelector("#item")!.setAttribute("hidden", "");
          // Return only once the session lists the tool unavailable, so it
          // goes unavailable while its own call is still running.
          while (
            listTools({ peeks: false }).some(
              ({ name, available }) =>
                name === "ListPage.items.archive" && available
            )
          )
            await new Promise((resolve) => setTimeout(resolve, 10));
          return "archived";
        },
      }),
    ];
  }
}

registerCompiledPom(ListPage, {
  className: "ListPage",
  tools: [],
  members: [
    {
      memberName: "items",
      kind: "component",
      access: "field",
      componentClassName: "ListItem",
      collection: true,
    },
  ],
  components: [
    {
      className: "ListItem",
      members: [{ memberName: "root", kind: "locator", access: "field" }],
      tools: [
        {
          methodName: "archive",
          toolName: "archive",
          description: "archive on ListItem.",
          parameters: [],
        },
      ],
    },
  ],
});

/** A Custom Tool with its own filter. */
const highlight: CustomTool = {
  name: "highlight",
  description: "Highlight an element.",
  filter: (element) => element.matches("[data-highlightable]"),
  execute: async () => undefined,
};

/** Every tool of the fixture session, in publication order, with its group. */
const EXPECTED_TOOLS: [string, PublishedToolGroup][] = [
  ["snapshot", "agent"],
  ["click", "browser"],
  ["hover", "browser"],
  ["type", "browser"],
  ["fill", "browser"],
  ["check", "browser"],
  ["uncheck", "browser"],
  ["select_option", "browser"],
  ["fill_form", "browser"],
  ["press_key", "browser"],
  ["generate_locator", "browser"],
  ["screenshot", "browser"],
  ["navigate", "browser"],
  ["navigate_back", "browser"],
  ["navigate_forward", "browser"],
  ["reload", "browser"],
  ["highlight", "custom"],
  ["TodoPage.addTodo", "pageObject"],
  ["goal", "agent"],
];

const names = (tools: readonly { name: string }[]) =>
  tools.map(({ name }) => name);

describe("the session's tools in Chromium", () => {
  let ayme: Ayme;
  const cleanups: (() => void)[] = [];

  /**
   * Start a session with TodoPage registered, the way the framework plugins
   * do. It lists `goal`, but no test runs a goal.
   */
  async function startSession(options: Parameters<typeof createAyme>[0] = {}) {
    ayme = createAyme({
      pageFactory: () => createPage({ actionTimeout: 1000 }),
      customTools: [highlight],
      goalLoop: async () => {
        throw new Error("No test runs a goal.");
      },
      ...options,
    });
    cleanups.push(registered(TodoPage));
    cleanups.push(ayme.start());
    // A Page Object lists its tools once the first observation has run.
    await probeRegisteredPomMembers();
  }

  afterEach(() => {
    for (const cleanup of cleanups.splice(0).reverse()) cleanup();
    document.body.innerHTML = "";
  });

  /** Register `model` with the session until the test ends. */
  function registered(model: PageObjectConstructor) {
    ayme.pom.register(model);
    return () => ayme.pom.unregister(model);
  }

  const agentCall = (name: string, input: unknown) =>
    agentTools().call(name, input);

  it("lists every tool in publication order, each in its group", async () => {
    await startSession();

    expect(ayme.tools.list().map(({ name, group }) => [name, group])).toEqual(
      EXPECTED_TOOLS
    );
  });

  it("tells subscribers when a Page Object registers, and returns a new list only then", async () => {
    await startSession();
    const before = ayme.tools.list();
    expect(ayme.tools.list()).toBe(before);
    const heard: (readonly ToolInfo[])[] = [];
    cleanups.push(ayme.tools.subscribe((tools) => heard.push(tools)));

    ayme.pom.register(SettingsPage);
    await expect
      .poll(() => names(ayme.tools.list()))
      .toContain("SettingsPage.save");
    expect(heard).toEqual([ayme.tools.list()]);
    expect(ayme.tools.list()).not.toBe(before);

    // A second registration changes nothing; the last one withdraws it.
    ayme.pom.register(SettingsPage);
    ayme.pom.unregister(SettingsPage);
    expect(heard).toHaveLength(1);
    ayme.pom.unregister(SettingsPage);
    expect(heard).toHaveLength(2);
    expect(heard[1]).toEqual(before);
  });

  it("reports to the agent what the application's action changed", async () => {
    document.body.innerHTML = `<button onclick="this.after('Saved')">Save changes</button>`;
    await startSession();
    const ref = await saveButtonRef();

    const applied = (await ayme.tools.run("click", { target: ref })).changes;
    const agentSees = (await agentCall("hover", { target: ref })) as {
      changes_before?: string;
      changes?: string;
    };

    expect(applied).toContain("Saved");
    // The app's action came before the agent's: the first part carries it.
    expect(agentSees.changes_before).toContain("Saved");
    expect(agentSees.changes ?? "").not.toContain("Saved");
  });

  it("throws a ToolInputError for input the tool's schema rejects, for an agent's call too", async () => {
    await startSession();
    // A name typed as any string, as an application passing user input does.
    const click: string = "click";

    await expect(ayme.tools.run(click, {})).rejects.toBeInstanceOf(
      ToolInputError
    );
    await expect(agentCall("click", {})).rejects.toBeInstanceOf(ToolInputError);
  });

  it("throws a failing call's error, for an agent's call too", async () => {
    document.body.innerHTML = `<button id="save">Save changes</button>`;
    await startSession();
    const ref = await saveButtonRef();
    document.querySelector("#save")!.remove();

    const error: unknown = await ayme.tools
      .run("click", { target: ref })
      .catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(AymeError);
    await expect(agentCall("click", { target: ref })).rejects.toThrow(
      (error as AymeError).message
    );
  });

  it("returns the result of a call that makes its own Page Object leave the page, then withdraws the tool", async () => {
    document.body.innerHTML = `<ul><li id="item">Draft</li></ul>`;
    await startSession();
    cleanups.push(registered(ListPage));
    await expect
      .poll(() => agentTools().names())
      .toContain("ListPage.items.archive");
    const { structure } = (await agentCall("snapshot", {})) as {
      structure: string;
    };
    const ref = structure.match(/(e\d+) ListPage\.items\[0\]/)?.[1];
    if (!ref) throw new Error("Expected a ref for ListPage.items[0].");
    const heard: (readonly ToolInfo[])[] = [];
    cleanups.push(ayme.tools.subscribe((tools) => heard.push(tools)));

    expect(
      await agentCall("ListPage.items.archive", { ref, args: {} })
    ).toMatchObject({ result: "archived" });

    // Subscribers heard of the change before the call returned.
    expect(heard.at(-1)?.map(({ name }) => name)).not.toContain(
      "ListPage.items.archive"
    );
    expect(heard.at(-1)).toBe(ayme.tools.list());
    expect(agentTools().names()).not.toContain("ListPage.items.archive");
  });

  it("leaves out a Page Object Tool whose Page Object is not on the page, refuses to run it, and lists it once the Page Object is", async () => {
    document.body.innerHTML = `<ul><li id="item" hidden>Draft</li></ul>`;
    await startSession();
    cleanups.push(registered(ListPage));
    const archive = () =>
      ayme.tools.list().find(({ name }) => name === "ListPage.items.archive");
    await expect
      .poll(() => ayme.tools.list().map(({ name }) => name))
      .toContain("snapshot");

    expect(archive()).toBeUndefined();
    await expect(
      ayme.tools.run("ListPage.items.archive", { ref: "e1", args: {} })
    ).rejects.toThrow(
      "ListPage.items.archive is unavailable: its Page Object is not on the page."
    );

    document.querySelector("#item")!.removeAttribute("hidden");
    await expect
      .poll(archive)
      .toMatchObject({ group: "pageObject", available: true });
    expect(agentTools().names()).toContain("ListPage.items.archive");
  });

  it("lists a Page Object Tool a click would not reach as unavailable with the element in the way, and refuses to run it", async () => {
    document.body.innerHTML = `<ul><li id="item">Draft</li></ul><dialog id="confirm" aria-label="Archive item"><button>Confirm</button></dialog>`;
    await startSession();
    cleanups.push(registered(ListPage));
    const archive = () =>
      ayme.tools.list().find(({ name }) => name === "ListPage.items.archive");
    await expect.poll(archive).toMatchObject({ available: true });
    const ref = (await agentTools().call("snapshot", {})) as {
      structure: string;
    };
    const item = ref.structure.match(/(e\d+) ListPage\.items\[0\]/)?.[1];
    if (!item) throw new Error("Expected a ref for ListPage.items[0].");

    document.querySelector<HTMLDialogElement>("#confirm")!.showModal();
    await expect.poll(archive).toMatchObject({ available: false });
    const { structure } = (await agentTools().call("snapshot", {})) as {
      structure: string;
    };
    const dialog = structure.match(/(e\d+) dialog "Archive item"/)?.[1];
    if (!dialog) throw new Error("Expected a ref for the dialog.");

    expect(archive()).toMatchObject({
      available: false,
      reason: `a click would not reach it; ${dialog} is in the way`,
    });
    expect(agentTools().names()).not.toContain("ListPage.items.archive");
    await expect(
      ayme.tools.run("ListPage.items.archive", { ref: item, args: {} })
    ).rejects.toThrow(
      `ListPage.items.archive is unavailable: a click would not reach it; ${dialog} is in the way.`
    );
    expect(document.querySelector("#item")!.hasAttribute("hidden")).toBe(false);

    document.querySelector<HTMLDialogElement>("#confirm")!.close();
    await expect.poll(archive).toMatchObject({ available: true });
    expect(archive()).not.toHaveProperty("reason");
  });

  it("gives each single-element tool the refs the Goal Loop offers it for the same page", async () => {
    document.body.innerHTML = `
      <button>Save</button>
      <button disabled>Archived</button>
      <label>Name <input value="Ada" /></label>
      <p data-highlightable>Draft</p>
    `;
    await startSession();
    const capture = await lookAtPageStateForDocument(document);
    const described = (refs: readonly AriaRef[] = []) =>
      refs.map((ref) => {
        const element = capture.elementsByRef.get(ref)!;
        return `${element.localName} ${element.textContent?.trim() || (element as HTMLInputElement).value}`;
      });

    const targets = await listElementToolTargets(capture);

    expect(
      Object.fromEntries(
        [...targets].map(([name, refs]) => [name, described(refs)])
      )
    ).toEqual({
      // Interactive and enabled; the disabled button is left out.
      click: ["button Save", "input Ada"],
      hover: ["button Save", "input Ada"],
      type: ["input Ada"],
      fill: ["input Ada"],
      check: [],
      uncheck: [],
      select_option: [],
      highlight: ["p Draft"],
    });
    for (const { key, tool } of buildToolOptions()) {
      if (!targets.has(key)) continue;
      // The element question alone: fill's free `text` would otherwise stop
      // the plan before the element is asked.
      const element = key === "highlight" ? "ref" : "target";
      const plan = planArguments(
        {
          ...tool,
          args: tool.args.filter((arg) => arg.name === element),
          requiredParams: [element],
        },
        capture
      );
      const offered =
        plan.kind === "ask"
          ? plan.questions
              .flatMap((question) =>
                question.type === "choice" && question.parameter === element
                  ? question.options
                  : []
              )
              .flatMap((option) =>
                option.value === undefined ? [] : [option.value]
              )
          : [];
      expect(targets.get(key), key).toEqual(offered);
    }
  });

  it("gives the POM definition text snapshot returns, without reading the page", async () => {
    await startSession();
    cleanups.push(registered(SettingsPage));
    const history = getInteractionHistory(document);
    const latest = history.latestObservation;

    const text = getPomDefinitionText("TodoPage");
    const all = getPomDefinitionText();

    expect(history.latestObservation).toBe(latest);
    const context = (names?: string[]) =>
      agentCall("snapshot", names ? { names } : {}) as Promise<{
        pomDefinitions: string;
      }>;
    expect(text).toBe((await context(["TodoPage"])).pomDefinitions);
    expect(all).toBe((await context()).pomDefinitions);
    // Diagnostic: the definitions are there to compare.
    expect(all).toMatch(
      /TodoPage[\s\S]*SettingsPage|SettingsPage[\s\S]*TodoPage/
    );
  });

  it("lists a bare action with only the Page Objects it shows next, and offers the Goal Loop a description of every one", async () => {
    await startSession();
    cleanups.push(registered(BarePage));
    await probeRegisteredPomMembers();
    const listed = (name: string) =>
      ayme.tools.list().find((tool) => tool.name === name);
    const label = (name: string) =>
      buildToolOptions().find(({ key }) => key === name)?.label;

    expect(listed("BarePage.open")).toMatchObject({
      returnPoms: ["SettingsPage"],
    });
    expect(listed("BarePage.open")).not.toHaveProperty("description");
    expect(listed("BarePage.close")).not.toHaveProperty("returnPoms");
    expect(label("BarePage.open")).toBe("Then shows SettingsPage.");
    expect(label("BarePage.close")).toBe("Run close.");
  });

  it("passes a rest parameter's list to the action as separate arguments", async () => {
    await startSession();
    cleanups.push(registered(GroupPage));
    await probeRegisteredPomMembers();
    GroupPage.calls = [];

    await ayme.tools.run("GroupPage.toggle", { group: 2, refs: ["e1", "e2"] });
    await ayme.tools.run("GroupPage.toggle", { group: 3 });

    expect(GroupPage.calls).toEqual([[2, "e1", "e2"], [3]]);
  });

  it("refuses to run a tool no Page Object registered", async () => {
    await startSession();

    await expect(
      ayme.tools.run("SettingsPage.save", { title: "Draft" })
    ).rejects.toThrow('There is no tool "SettingsPage.save".');
  });

  it("lists no tool, and refuses every call, while two tools share a name", async () => {
    await startSession({
      customTools: [{ ...highlight, name: "TodoPage.addTodo" }],
    });
    const clash =
      'Cannot publish the tool "TodoPage.addTodo": another published tool already uses that name.';

    expect(ayme.tools.list()).toEqual([]);
    await expect(ayme.tools.run("snapshot", {})).rejects.toThrow(clash);
  });
});
