/**
 * Browser-test scenario, shared by the native WebMCP and the polyfill runs:
 * the internal list of published tools is exactly what the runtime session
 * has published to WebMCP: every tool while publication is active, nothing
 * while it is disabled, failed or stopped. Running a published tool from the
 * internal entry returns what an agent gets for the same call.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  ChromeModelContextExtensions,
  ModelContext as WebMcpModelContext,
  RegisteredTool,
} from "@mcp-b/webmcp-types";
import { AriaRefSchema } from "@ayme-dev/core/structural-observation";
import { createPage } from "@ayme-dev/playwright-lite";

import type { PomManifest } from "./contracts";
import type { DecisionRequest, DecisionResponse } from "./decisionTypes";
import {
  getPublicationStatus,
  listPublishedTools,
  listRefToolTargets,
  runPublishedTool,
  subscribeToPublishedTools,
  type PublishedToolGroup,
} from "./publishedTools";
import type { RefTool } from "./refTools";
import { buildToolOptions, planArguments } from "./goalLoopQuestions";
import { getPomDefinitionText } from "./pageContext";
import {
  getInteractionHistory,
  peekPageStateForDocument,
  type AriaRef,
} from "./pageState";
import { registerCompiledPom } from "./registry";
import { runTool } from "./webMcp";
import { createRuntimeSession, type RuntimeSession } from "./runtime";

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

/** Every tool the fixture session publishes, in the group the Inspector shows it under. */
const EXPECTED_GROUPS: Record<string, PublishedToolGroup> = {
  get_page_context: "agent",
  pursue_goal: "agent",
  click_page_state_ref: "ref",
  fill_page_state_ref: "ref",
  highlight: "ref",
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
type SessionOptions = Parameters<typeof createRuntimeSession>[0];

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

/** An app-registered Ref Tool with its own filter. */
const highlight: RefTool = {
  name: "highlight",
  description: "Highlight an element.",
  filter: (element) => element.matches("[data-highlightable]"),
  execute: async () => undefined,
};

const TOOL_CALLS: [string, string, (ref: string) => unknown][] = [
  ["a Page Object tool", "TodoPage.addTodo", () => ({ title: "Milk" })],
  ["the built-in click Ref tool", "click_page_state_ref", (ref) => ({ ref })],
  ["an app-registered Ref tool", "highlight", (ref) => ({ ref })],
  ["get_page_context", "get_page_context", () => ({})],
  [
    "pursue_goal",
    "pursue_goal",
    () => ({ goal: "Save the changes", maxSteps: 1 }),
  ],
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
    let runtime: RuntimeSession;
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
      vi.stubGlobal("__AYME_WEBMCP_PUBLISH__", publish);
      runtime = createRuntimeSession({
        page: () => createPage({ actionTimeout: 1000 }),
        refTools: [highlight],
        goalLoop: noFittingOperation,
        ...options,
      });
      cleanups.push(runtime.register(TodoPage, runtime.construct(TodoPage)));
      const stop = runtime.start();
      cleanups.push(stop);
      // Without a driver, the session waits two seconds before giving up.
      await expect
        .poll(() => runtime.getSnapshot().state, { timeout: 5_000 })
        .not.toBe("waiting");
      // Diagnostic: a session meant to publish reached WebMCP, or failed for
      // the reason its test gives, before the Contract runs.
      if (expectedState)
        expect(runtime.getSnapshot().state).toBe(expectedState);
      else if (publish && !options.refTools)
        expect(runtime.getSnapshot().state).toBe("active");
      return stop;
    }

    beforeEach(() => {
      context = getContext();
    });

    afterEach(() => {
      for (const cleanup of cleanups.splice(0).reverse()) cleanup();
      vi.unstubAllGlobals();
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

    async function saveButtonRef() {
      const { structure } = (await agentGets("get_page_context", {})) as {
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

    it("puts each published tool in its group", async () => {
      await startSession();

      expect(
        Object.fromEntries(
          listPublishedTools().map(({ name, group }) => [name, group])
        )
      ).toEqual(EXPECTED_GROUPS);
    });

    it("tells subscribers when the published set changes, and lists the new set", async () => {
      await startSession();
      let notified = false;
      cleanups.push(
        subscribeToPublishedTools(() => {
          notified = true;
        })
      );

      cleanups.push(
        runtime.register(SettingsPage, runtime.construct(SettingsPage))
      );
      await expect
        .poll(() => listPublishedTools().map(({ name }) => name))
        .toContain("SettingsPage.save");

      expect(notified).toBe(true);
      expect(listed()).toEqual(await publishedOverWebMcp(context));
    });

    it("lists nothing while publication is disabled", async () => {
      await startSession({ publish: false });

      expect(getPublicationStatus().state).toBe("disabled");
      expect(listed()).toEqual([]);
      expect(await publishedOverWebMcp(context)).toEqual([]);
    });

    it("lists nothing, and reports the error, when publication fails on a name clash", async () => {
      await startSession({
        refTools: [{ ...highlight, name: "TodoPage.addTodo" }],
      });

      expect(getPublicationStatus()).toEqual({
        state: "failed",
        message: expect.stringContaining(
          'Cannot publish the Ref Tool "TodoPage.addTodo"'
        ),
      });
      expect(listed()).toEqual([]);
      expect(await publishedOverWebMcp(context)).toEqual([]);
    });

    it("lists nothing once the session stops", async () => {
      const stop = await startSession();
      const heard: string[] = [];
      cleanups.push(
        subscribeToPublishedTools(() => {
          heard.push(getPublicationStatus().state);
        })
      );

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
        await agentGets("get_page_context", {});
        const expected = await agentGets(name, input);
        // Diagnostic: the call itself succeeds for an agent.
        expect(expected).not.toMatchObject({ isError: true });
        await agentGets("get_page_context", {});

        expect(await runPublishedTool(name, input)).toEqual(expected);
      }
    );

    it("returns a failing call's error result as an agent gets it", async () => {
      document.body.innerHTML = `<button id="save">Save changes</button>`;
      await startSession();
      const ref = await saveButtonRef();
      document.querySelector("#save")!.remove();
      const expected = await agentGets("click_page_state_ref", { ref });

      expect(await runPublishedTool("click_page_state_ref", { ref })).toEqual(
        expected
      );
      expect(expected).toMatchObject({ isError: true });
    });

    it("gives each Ref tool the refs the Goal Loop offers it for the same page", async () => {
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

      const targets = await listRefToolTargets(capture);

      expect(
        Object.fromEntries(
          [...targets].map(([name, refs]) => [name, described(refs)])
        )
      ).toEqual({
        // Interactive and enabled; the disabled button is left out.
        click_page_state_ref: ["button Save", "input Ada"],
        fill_page_state_ref: ["input Ada"],
        highlight: ["p Draft"],
      });
      for (const { key, tool } of buildToolOptions()) {
        if (!targets.has(key)) continue;
        // The ref question alone: fill's free `value` would otherwise stop
        // the plan before the ref is asked.
        const plan = planArguments(
          {
            ...tool,
            args: tool.args.filter((arg) => arg.name === "ref"),
            requiredParams: ["ref"],
          },
          capture
        );
        const offered =
          plan.kind === "ask"
            ? plan.questions
                .find((question) => question.parameter === "ref")!
                .options.flatMap((option) =>
                  option.value === undefined ? [] : [option.value]
                )
            : [];
        expect(targets.get(key), key).toEqual(offered);
      }
    });

    it("gives the POM definition text get_page_context returns, without reading the page", async () => {
      await startSession();
      cleanups.push(
        runtime.register(SettingsPage, runtime.construct(SettingsPage))
      );
      const history = getInteractionHistory(document);
      const latest = history.latestObservation;

      const text = getPomDefinitionText("TodoPage");
      const all = getPomDefinitionText();

      expect(history.latestObservation).toBe(latest);
      const context = (names?: string[]) =>
        agentGets("get_page_context", names ? { names } : {}) as Promise<{
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
          await agentGets("get_page_context", {});
          const expected = await agentGets(name, input);
          // Diagnostic: the call itself succeeds for an agent.
          expect(expected).not.toMatchObject({ isError: true });
          stopPublishing();

          const actual = await whilePublicationIsOff(mode, async () => {
            await runTool("get_page_context", {});
            return runTool(name, input);
          });

          expect(actual).toEqual(expected);
        }
      );

      it("returns a failing call's error result as an agent gets it", async () => {
        document.body.innerHTML = `<button id="save">Save changes</button>`;
        const stopPublishing = await startSession();
        const ref = await saveButtonRef();
        document.querySelector("#save")!.remove();
        const expected = await agentGets("click_page_state_ref", { ref });
        expect(expected).toMatchObject({ isError: true });
        stopPublishing();

        const actual = await whilePublicationIsOff(mode, () =>
          runTool("click_page_state_ref", { ref })
        );

        expect(actual).toEqual(expected);
      });

      it("refuses to run a tool that is not live", async () => {
        await expect(
          whilePublicationIsOff(mode, () =>
            runTool("SettingsPage.save", { title: "x" })
          )
        ).rejects.toThrow('The tool "SettingsPage.save" is not live.');
      });
    });

    it("refuses to run a tool that is not published", async () => {
      await startSession();

      await expect(
        runPublishedTool("SettingsPage.save", { title: "x" })
      ).rejects.toThrow('The tool "SettingsPage.save" is not published.');
    });
  });
}
