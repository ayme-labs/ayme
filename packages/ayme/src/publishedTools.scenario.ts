/**
 * Browser-test scenario, shared by the native WebMCP and the polyfill runs:
 * the internal list of published tools is exactly what the runtime session
 * has published to WebMCP: every tool while publication is active, nothing
 * while it is disabled, failed or stopped. Running a tool through the runtime
 * session returns what an agent gets for the same call.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type {
  ChromeModelContextExtensions,
  ModelContext as WebMcpModelContext,
  RegisteredTool,
} from "@mcp-b/webmcp-types";
import { AriaRefSchema } from "@ayme-dev/core/structural-observation";
import { createPage } from "@ayme-dev/playwright-lite";
import type { Page } from "@playwright/test";

import type { PomManifest } from "./contracts";
import type { DecisionRequest, DecisionResponse } from "./decisionTypes";
import {
  listLiveTools,
  listPublishedTools,
  listElementToolTargets,
  type PublishedToolGroup,
} from "./publishedTools";
import type { CustomTool } from "./elementTools";
import { buildToolOptions, planArguments } from "./goalLoopQuestions";
import { getPomDefinitionText } from "./pageContext";
import {
  getInteractionHistory,
  peekPageStateForDocument,
  type AriaRef,
} from "./pageState";
import { registerCompiledPom, type PageObjectConstructor } from "./registry";
import { createAyme, type Ayme } from "./runtime";
import { AymeError, ToolInputError } from "./errors";
import { withErrorResult } from "./webMcp";

// --- Fixtures: one tool of each kind an agent can be given ---

const pomManifest = (className: string, methodName: string): PomManifest => ({
  className,
  members: [],
  tools: [
    {
      methodName,
      toolName: `${className}.${methodName}`,
      description: `${methodName} on ${className}.`,
      inputSchema: {
        type: "object",
        properties: { title: { type: "string" } },
        required: ["title"],
        additionalProperties: false,
      },
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

registerCompiledPom(TodoPage, pomManifest("TodoPage", "addTodo"));
registerCompiledPom(SettingsPage, pomManifest("SettingsPage", "save"));

/**
 * One list item whose archive action makes the item unavailable while the
 * call is still running, as a confirmation dialog opened over it does.
 */
class ListPage {
  readonly items;

  constructor(page: Page) {
    this.items = [
      {
        root: page.locator("#item"),
        async archive() {
          document.querySelector("#item")!.setAttribute("hidden", "");
          // Return only once the page change has reached publication, so the
          // tool goes unavailable while its own call is still running.
          while (
            listLiveTools().some(
              ({ name }) => name === "ListPage.items.archive"
            )
          )
            await new Promise((resolve) => setTimeout(resolve, 10));
          return "archived";
        },
      },
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
          inputSchema: {
            type: "object",
            properties: {},
            required: [],
            additionalProperties: false,
          },
          parameters: [],
        },
      ],
    },
  ],
});

/** Every tool the fixture session publishes, in the group the Inspector shows it under. */
const EXPECTED_GROUPS: Record<string, PublishedToolGroup> = {
  snapshot: "agent",
  goal: "agent",
  click: "browser",
  hover: "browser",
  type: "browser",
  fill: "browser",
  check: "browser",
  uncheck: "browser",
  select_option: "browser",
  fill_form: "browser",
  press_key: "browser",
  navigate: "browser",
  navigate_back: "browser",
  navigate_forward: "browser",
  reload: "browser",
  highlight: "custom",
  "TodoPage.addTodo": "pageObject",
};

// --- Mechanics ---

/** A tool as an agent reads it from WebMCP: name, description and schema. */
function asAgentSees(tool: RegisteredTool) {
  return {
    name: tool.name,
    description: tool.description,
    inputSchema:
      typeof tool.inputSchema === "string"
        ? (JSON.parse(tool.inputSchema) as unknown)
        : tool.inputSchema,
  };
}

async function publishedOverWebMcp(context: ModelContext) {
  return (await context.getTools()).map(asAgentSees).sort(byName);
}

function listed() {
  return listPublishedTools()
    .map(({ name, description, inputSchema }) => ({
      name,
      description,
      inputSchema,
    }))
    .sort(byName);
}

function byName(a: { name: string }, b: { name: string }) {
  return a.name.localeCompare(b.name);
}

type ModelContext = WebMcpModelContext & ChromeModelContextExtensions;
type SessionOptions = Parameters<typeof createAyme>[0];

/** A stubbed System One model: no operation fits, so the loop hands over. */
async function noFittingOperation(
  request: DecisionRequest
): Promise<DecisionResponse> {
  const criteria = (
    request.questions as Record<string, { criteria?: Record<string, string> }>
  ).operation!.criteria!;
  return {
    model: request.model,
    answers: {
      operation: {
        type: "choice",
        choice: "none",
        confidence: 1,
        probabilities: Object.fromEntries(
          Object.keys(criteria).map((key) => [key, key === "none" ? 1 : 0])
        ),
      },
      goal_met: { type: "noul", noul: 0.1 },
    },
  };
}

/** A Custom Tool with its own filter. */
const highlight: CustomTool = {
  name: "highlight",
  description: "Highlight an element.",
  filter: (element) => element.matches("[data-highlightable]"),
  execute: async () => undefined,
};

const TOOL_CALLS: [string, string, (ref: string) => object][] = [
  ["a Page Object tool", "TodoPage.addTodo", () => ({ title: "Milk" })],
  ["the click Browser Tool", "click", (ref) => ({ target: ref })],
  ["an app-registered Custom Tool", "highlight", (ref) => ({ ref })],
  ["snapshot", "snapshot", () => ({})],
  ["goal", "goal", () => ({ goal: "Save the changes", maxSteps: 1 })],
];

/**
 * `removeDriver` takes WebMCP off the page and returns a function that puts it
 * back; given, the runs without publication also cover the no-driver case.
 */
export function describePublishedTools(
  label: string,
  getContext: () => ModelContext,
  removeDriver?: () => () => void
): void {
  describe(`published tools through ${label}`, () => {
    let context: ModelContext;
    let runtime: Ayme;
    const cleanups: (() => void)[] = [];

    /**
     * Start a runtime session with TodoPage registered, the way the framework
     * plugins do, and wait until its publication settles.
     */
    async function startSession({
      publish = true,
      expectedState,
      ...options
    }: SessionOptions & {
      publish?: boolean;
      expectedState?: string;
    } = {}) {
      runtime = createAyme({
        pageFactory: () => createPage({ actionTimeout: 1000 }),
        customTools: [highlight],
        goalLoop: noFittingOperation,
        webMCP: { enabled: publish },
        ...options,
      });
      cleanups.push(registered(TodoPage));
      const stop = runtime.start();
      cleanups.push(stop);
      // Without a driver, the session waits two seconds before giving up.
      await expect
        .poll(() => runtime.webMCP.publicationStatus.state, { timeout: 5_000 })
        .not.toBe("waiting");
      // Diagnostic: a session meant to publish reached WebMCP, or failed for
      // the reason its test gives, before the Contract runs.
      if (expectedState)
        expect(runtime.webMCP.publicationStatus.state).toBe(expectedState);
      else if (publish && !options.customTools)
        expect(runtime.webMCP.publicationStatus.state).toBe("active");
      return stop;
    }

    beforeEach(() => {
      context = getContext();
    });

    afterEach(() => {
      for (const cleanup of cleanups.splice(0).reverse()) cleanup();
      document.body.innerHTML = "";
    });

    /** What an agent gets back from WebMCP for this call. */
    async function agentGets(name: string, input: unknown) {
      const tool = (await context.getTools()).find(
        (candidate) => candidate.name === name
      );
      if (!tool) throw new Error(`Tool ${name} was not published.`);
      return JSON.parse(
        (await context.executeTool!(tool, JSON.stringify(input))) ?? "null"
      ) as unknown;
    }

    /**
     * What the application gets from the session for this call; a failure as
     * the result an agent gets for it.
     */
    function appGets(name: string, input: object) {
      return withErrorResult({
        execute: (input) => runtime.tools.run(name, input as object),
      }).execute(input);
    }

    /** Register `model` with the session until the test ends. */
    function registered(model: PageObjectConstructor) {
      runtime.pom.register(model);
      return () => runtime.pom.unregister(model);
    }

    async function saveButtonRef() {
      const { structure } = (await agentGets("snapshot", {})) as {
        structure: string;
      };
      const ref = structure.match(/(e\d+) button "Save changes"/)?.[1];
      if (!ref) throw new Error("Expected a Structural Ref for Save changes.");
      return AriaRefSchema.parse(ref);
    }

    it("lists each published tool with the name, description and input schema WebMCP publishes", async () => {
      await startSession();

      expect(listed()).toEqual(await publishedOverWebMcp(context));
    });

    it("lists the live tools as published while publication is active", async () => {
      await startSession();

      expect(runtime.tools.list()).toEqual(listPublishedTools());
    });

    it("puts each published tool in its group", async () => {
      await startSession();

      expect(
        Object.fromEntries(
          listPublishedTools().map(({ name, group }) => [name, group])
        )
      ).toEqual(EXPECTED_GROUPS);
    });

    it("lists the new set when the published set changes", async () => {
      await startSession();

      cleanups.push(registered(SettingsPage));
      await expect
        .poll(() => listPublishedTools().map(({ name }) => name))
        .toContain("SettingsPage.save");

      expect(listed()).toEqual(await publishedOverWebMcp(context));
    });

    it("publishes nothing and reads disabled when webMCP.enabled is unset", async () => {
      await startSession({ webMCP: {}, expectedState: "disabled" });

      expect(await publishedOverWebMcp(context)).toEqual([]);
    });

    it("lists nothing while publication is disabled", async () => {
      await startSession({ publish: false });

      expect(runtime.webMCP.publicationStatus.state).toBe("disabled");
      expect(listed()).toEqual([]);
      expect(await publishedOverWebMcp(context)).toEqual([]);
    });

    it("reports to the agent what the application's action changed", async () => {
      document.body.innerHTML = `<button onclick="this.after('Saved')">Save changes</button>`;
      await startSession();
      const ref = await saveButtonRef();

      const applied = (await runtime.tools.run("click", { target: ref }))
        .changes;
      const agentSees = (await agentGets("hover", { target: ref })) as {
        changes?: string;
      };

      expect(applied).toContain("Saved");
      expect(agentSees.changes).toContain("Saved");
    });

    it("publishes every tool under toolNamePrefix, and the Goal Loop still runs", async () => {
      document.body.innerHTML = `<button data-highlightable>Save changes</button>`;
      await startSession({
        webMCP: { enabled: true, toolNamePrefix: "ayme_" },
      });

      expect(
        (await publishedOverWebMcp(context)).map(({ name }) => name).sort()
      ).toEqual(
        Object.keys(EXPECTED_GROUPS)
          .map((name) => `ayme_${name}`)
          .sort()
      );
      expect(
        await agentGets("ayme_goal", {
          goal: "Save the changes",
          maxSteps: 1,
        })
      ).toMatchObject({ reason: "no_fitting_option" });
    });

    it("lists nothing, and reports the error, when publication fails on a name clash", async () => {
      await startSession({
        customTools: [{ ...highlight, name: "TodoPage.addTodo" }],
      });

      expect(runtime.webMCP.publicationStatus).toEqual({
        state: "failed",
        message: expect.stringContaining(
          'Cannot publish the tool "TodoPage.addTodo"'
        ),
      });
      expect(listed()).toEqual([]);
      expect(await publishedOverWebMcp(context)).toEqual([]);
    });

    it("lists nothing once the session stops", async () => {
      const stop = await startSession();
      const heard: string[] = [];
      cleanups.push(runtime.webMCP.subscribe(({ state }) => heard.push(state)));

      stop();

      expect(heard.at(-1)).toBe("disposed");
      expect(listed()).toEqual([]);
      expect(await publishedOverWebMcp(context)).toEqual([]);
    });

    it.each(TOOL_CALLS)(
      "runs %s and returns what an agent gets for the same call",
      async (_kind, name, inputFor) => {
        document.body.innerHTML = `<button data-highlightable>Save changes</button>`;
        await startSession();
        const input = inputFor(await saveButtonRef());
        // A click focuses the button, so it is focused before the first call
        // too. Both calls then start from the same page, already seen.
        document.querySelector("button")!.focus();
        await agentGets("snapshot", {});
        const expected = await agentGets(name, input);
        // Diagnostic: the call itself succeeds for an agent.
        expect(expected).not.toMatchObject({ isError: true });
        await appGets("snapshot", {});

        expect(await appGets(name, input)).toEqual(expected);
      }
    );

    it("throws a failing call's error with the text an agent gets", async () => {
      document.body.innerHTML = `<button id="save">Save changes</button>`;
      await startSession();
      const ref = await saveButtonRef();
      document.querySelector("#save")!.remove();
      const expected = await agentGets("click", { target: ref });

      await expect(
        runtime.tools.run("click", { target: ref })
      ).rejects.toBeInstanceOf(AymeError);
      expect(await appGets("click", { target: ref })).toEqual(expected);
      expect(expected).toMatchObject({ isError: true });
    });

    it("throws a ToolInputError for input the tool's schema rejects", async () => {
      await startSession();
      // A name typed as any string, as an application passing user input does.
      const click: string = "click";

      await expect(runtime.tools.run(click, {})).rejects.toBeInstanceOf(
        ToolInputError
      );
      expect(await appGets("click", {})).toEqual(await agentGets("click", {}));
    });

    it("returns the result of a call that makes its own tool unavailable, then withdraws the tool", async () => {
      document.body.innerHTML = `<ul><li id="item">Draft</li></ul>`;
      await startSession();
      cleanups.push(registered(ListPage));
      await expect
        .poll(async () => (await context.getTools()).map(({ name }) => name))
        .toContain("ListPage.items.archive");
      const { structure } = (await agentGets("snapshot", {})) as {
        structure: string;
      };
      const ref = structure.match(/(e\d+) ListPage\.items\[0\]/)?.[1];
      if (!ref) throw new Error("Expected a ref for ListPage.items[0].");

      const heard: (readonly { name: string }[])[] = [];
      cleanups.push(runtime.tools.subscribe((tools) => heard.push(tools)));

      expect(
        await agentGets("ListPage.items.archive", { ref, args: {} })
      ).toMatchObject({ result: "archived" });
      await expect
        .poll(async () => (await context.getTools()).map(({ name }) => name))
        .not.toContain("ListPage.items.archive");
      // The item's availability changed, so the session's list changed with it.
      expect(heard.at(-1)?.map(({ name }) => name)).not.toContain(
        "ListPage.items.archive"
      );
      expect(heard.at(-1)).toBe(runtime.tools.list());
    });

    it("gives each single-element tool the refs the Goal Loop offers it for the same page", async () => {
      document.body.innerHTML = `
        <button>Save</button>
        <button disabled>Archived</button>
        <label>Name <input value="Ada" /></label>
        <p data-highlightable>Draft</p>
      `;
      await startSession();
      const capture = await peekPageStateForDocument(document);
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
                .find((question) => question.parameter === element)!
                .options.flatMap((option) =>
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
        agentGets("snapshot", names ? { names } : {}) as Promise<{
          pomDefinitions: string;
        }>;
      expect(text).toBe((await context(["TodoPage"])).pomDefinitions);
      expect(all).toBe((await context()).pomDefinitions);
      // Diagnostic: the definitions are there to compare.
      expect(all).toMatch(
        /TodoPage[\s\S]*SettingsPage|SettingsPage[\s\S]*TodoPage/
      );
    });

    // --- Running a tool while publication is off ---

    const offModes = [
      { off: "publication is disabled", publish: false, state: "disabled" },
      ...(removeDriver
        ? [
            {
              off: "the page has no driver",
              publish: true,
              state: "unavailable",
            },
          ]
        : []),
    ];

    /**
     * Start a session whose publication is off, run `calls` in it, and put
     * the driver back if it was removed.
     */
    async function whilePublicationIsOff<T>(
      mode: (typeof offModes)[number],
      calls: () => Promise<T>
    ): Promise<T> {
      const restore = mode.state === "unavailable" ? removeDriver!() : () => {};
      try {
        await startSession({
          publish: mode.publish,
          expectedState: mode.state,
        });
        return await calls();
      } finally {
        restore();
      }
    }

    describe.each(offModes)("while $off", (mode) => {
      it.each(TOOL_CALLS)(
        "runs %s and returns what an agent gets with publication on",
        async (_kind, name, inputFor) => {
          document.body.innerHTML = `<button data-highlightable>Save changes</button>`;
          const stopPublishing = await startSession();
          const input = inputFor(await saveButtonRef());
          // Both calls start from the same page, already seen by the agent.
          document.querySelector("button")!.focus();
          await agentGets("snapshot", {});
          const expected = await agentGets(name, input);
          // Diagnostic: the call itself succeeds for an agent.
          expect(expected).not.toMatchObject({ isError: true });
          stopPublishing();

          const actual = await whilePublicationIsOff(mode, async () => {
            await appGets("snapshot", {});
            return appGets(name, input);
          });

          expect(actual).toEqual(expected);
        }
      );

      it("throws a failing call's error with the text an agent gets", async () => {
        document.body.innerHTML = `<button id="save">Save changes</button>`;
        const stopPublishing = await startSession();
        const ref = await saveButtonRef();
        document.querySelector("#save")!.remove();
        const expected = await agentGets("click", { target: ref });
        expect(expected).toMatchObject({ isError: true });
        stopPublishing();

        const actual = await whilePublicationIsOff(mode, () =>
          appGets("click", { target: ref })
        );

        expect(actual).toEqual(expected);
      });

      it("lists the live tools as published with publication on", async () => {
        const stopPublishing = await startSession();
        const published = listPublishedTools();
        stopPublishing();

        const live = await whilePublicationIsOff(mode, async () =>
          runtime.tools.list()
        );

        expect(live).toEqual(published);
      });

      it("tells subscribers when a Page Object registers, and returns a new list only then", async () => {
        await whilePublicationIsOff(mode, async () => {
          const before = runtime.tools.list();
          expect(runtime.tools.list()).toBe(before);
          const heard: (readonly { name: string }[])[] = [];
          cleanups.push(runtime.tools.subscribe((tools) => heard.push(tools)));

          runtime.pom.register(SettingsPage);
          await expect
            .poll(() => runtime.tools.list().map(({ name }) => name))
            .toContain("SettingsPage.save");
          expect(heard).toEqual([runtime.tools.list()]);
          expect(runtime.tools.list()).not.toBe(before);

          // A second registration changes nothing; the last one withdraws it.
          runtime.pom.register(SettingsPage);
          runtime.pom.unregister(SettingsPage);
          expect(heard).toHaveLength(1);
          runtime.pom.unregister(SettingsPage);
          expect(heard).toHaveLength(2);
          expect(heard[1]).toEqual(before);
        });
      });

      it("lists each single-element tool's targets", async () => {
        document.body.innerHTML = `<button>Save</button><p data-highlightable>Draft</p>`;

        const targets = await whilePublicationIsOff(mode, () =>
          listElementToolTargets()
        );

        const peek = await peekPageStateForDocument(document);
        const described = (name: string) =>
          (targets.get(name) ?? []).map(
            (ref) => peek.elementsByRef.get(ref)?.textContent
          );
        expect(described("click")).toEqual(["Save"]);
        expect(described("highlight")).toEqual(["Draft"]);
      });

      it("refuses to run a tool that is not live", async () => {
        await expect(
          whilePublicationIsOff(mode, () =>
            runtime.tools.run("SettingsPage.save", { title: "x" })
          )
        ).rejects.toThrow('The tool "SettingsPage.save" is not live.');
      });
    });
  });
}
