import { afterEach, describe, expect, it, vi } from "vitest";

import type { DecisionRequest } from "./decisionTypes";
import type { ToolManifest } from "./contracts";
import { createPage } from "./browserPage";
import { RuntimeStateError } from "./errors";
import type { GoalLoopDecisionFunction } from "./goalLoop";
import { registerCompiledPom } from "./registry";
import { createAyme, type Ayme, type AymeOptions } from "./runtime";
import { synchronizeWebMcpTools } from "./webMcp";

// Runtime object seam: an app adds Peeks with `ayme.peek` and reads them as
// Peek Tools through `ayme.tools`, the set the Agent Connection's page client
// publishes and runs.

// The Agent Connection and the Inspector load as no-ops that keep the
// session they are started with: the dev gate only needs their options on,
// and a real page client would scan for an agent's Ayme MCP server.
const connected = vi.hoisted(() => ({ sessions: [] as unknown[] }));
vi.mock("./agentConnection", () => ({
  loadProcessConnection: async () => {
    throw new Error("A page never loads an App Process's connection.");
  },
  loadAgentConnection: async () => ({
    startAgentConnection: (ayme: unknown) => {
      connected.sessions.push(ayme);
      return { dispose() {} };
    },
  }),
}));
vi.mock("./inspector", () => ({
  loadInspector: async () => ({
    mountInspector: () => ({ dispose() {} }),
  }),
}));

const page = createPage();

let cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.reverse()) cleanup();
  cleanups = [];
  connected.sessions = [];
  document.body.innerHTML = "";
});

/** A started session; Peeks are live in it unless `options` turn them off. */
function started(options: AymeOptions = { agentConnection: true }) {
  const ayme = createAyme({ pageFactory: () => page, ...options });
  cleanups.push(ayme.start());
  return ayme;
}

/** Adds a Peek that the test removes when it ends. */
function peek(ayme: Ayme, ...args: Parameters<Ayme["peek"]>) {
  const remove = ayme.peek(...args);
  cleanups.push(remove);
  return remove;
}

const toolNames = (ayme: Ayme) => ayme.tools.list().map(({ name }) => name);

/** The tool lists `ayme` announces from now on. */
function heardLists(ayme: Ayme) {
  const heard: string[][] = [];
  cleanups.push(
    ayme.tools.subscribe((tools) => heard.push(tools.map(({ name }) => name)))
  );
  return heard;
}

/** Lets queued microtasks and one timer turn run. */
const nextTurn = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("Peek Tools", () => {
  it("offers one Peek Tool per name, reading every live instance", async () => {
    const ayme = started();
    let count = 1;
    peek(ayme, () => ({ count }), "counter", "first");
    peek(ayme, () => ({ count: 10 }), "counter", "second");

    expect(ayme.tools.list().filter(({ group }) => group === "peek")).toEqual([
      {
        name: "peek.counter",
        description: expect.stringContaining("counter"),
        inputSchema: {
          type: "object",
          properties: {},
          additionalProperties: false,
        },
        group: "peek",
      },
    ]);
    count = 2;
    expect(await ayme.tools.run("peek.counter", {})).toEqual({
      name: "counter",
      instances: [
        { id: "first", values: { count: 2 } },
        { id: "second", values: { count: 10 } },
      ],
    });
  });

  it("names the tool after the Peek, with other characters replaced by _", async () => {
    const ayme = started();
    peek(ayme, () => [1, 2], "cart items/v2.draft-1");

    expect(toolNames(ayme)).toContain("peek.cart_items_v2.draft-1");
    expect(await ayme.tools.run("peek.cart_items_v2.draft-1", {})).toEqual({
      name: "cart items/v2.draft-1",
      instances: [{ values: [1, 2] }],
    });
  });

  it("refuses a name whose tool name another Peek's already has", () => {
    const ayme = started();
    peek(ayme, () => 1, "cart items");

    expect(() => ayme.peek(() => 2, "cart/items")).toThrow(RuntimeStateError);
  });

  it("refuses a browser name that would read as an App Process's peek.node. tool", () => {
    const ayme = started();

    expect(() => ayme.peek(() => 1, "node.jobs")).toThrow(RuntimeStateError);
    expect(() => ayme.peek(() => 1, "node/jobs")).not.toThrow();
    expect(toolNames(ayme)).not.toContain("peek.node.jobs");
  });

  it("refuses a Peek whose tool name another tool already uses", () => {
    const ayme = started({
      agentConnection: true,
      customTools: [
        {
          name: "peek.highlight",
          description: "Highlight one element.",
          execute: async () => "highlighted",
        },
      ],
    });

    expect(() => ayme.peek(() => 1, "highlight")).toThrow(RuntimeStateError);
    expect(
      ayme.tools.list().find(({ name }) => name === "peek.highlight")?.group
    ).toBe("custom");
  });

  it("warns and leaves out a Peek Tool whose name a later tool takes", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    cleanups.push(() => warn.mockRestore());
    const ayme = createAyme({
      pageFactory: () => page,
      agentConnection: true,
      customTools: [
        {
          name: "peek.outline",
          description: "Outline one element.",
          execute: async () => "outlined",
        },
      ],
    });
    // Before start, the Custom Tool is not live yet.
    peek(ayme, () => 1, "outline");

    cleanups.push(ayme.start());

    expect(
      ayme.tools.list().filter(({ name }) => name === "peek.outline")
    ).toEqual([expect.objectContaining({ group: "custom" })]);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("peek.outline is hidden")
    );
  });

  it("returns the values as JSON", async () => {
    const ayme = started();
    peek(
      ayme,
      () => ({ at: new Date("2026-10-06T12:00:00.000Z"), gone: undefined }),
      "dates",
      "a"
    );
    peek(ayme, () => undefined, "dates", "b");

    expect(await ayme.tools.run("peek.dates", {})).toEqual({
      name: "dates",
      instances: [
        { id: "a", values: { at: "2026-10-06T12:00:00.000Z" } },
        { id: "b", values: null },
      ],
    });
  });

  it("updates an instance in place when the same name and id come again", async () => {
    const ayme = started();
    const removeFirst = ayme.peek(() => ({ step: 1 }), "form", "signup");
    peek(ayme, () => ({ step: 2 }), "form", "signup");

    expect(await ayme.tools.run("peek.form", {})).toEqual({
      name: "form",
      instances: [{ id: "signup", values: { step: 2 } }],
    });

    // The instance is the same one, so the first call's remover removes it.
    removeFirst();
    await expect.poll(() => toolNames(ayme)).not.toContain("peek.form");
  });

  it("replaces the instance without an id with the newest call", async () => {
    const ayme = started();
    const removeOld = ayme.peek(() => ({ version: 1 }), "store");
    peek(ayme, () => ({ version: 2 }), "store");

    expect(await ayme.tools.run("peek.store", {})).toEqual({
      name: "store",
      instances: [{ values: { version: 2 } }],
    });

    // A module that ran again replaced its Peek: the old remover leaves it.
    removeOld();
    await nextTurn();
    expect(await ayme.tools.run("peek.store", {})).toEqual({
      name: "store",
      instances: [{ values: { version: 2 } }],
    });
  });

  it("awaits an async read", async () => {
    const ayme = started();
    peek(
      ayme,
      () =>
        new Promise((resolve) => setTimeout(() => resolve({ rows: 3 }), 10)),
      "server"
    );

    expect(await ayme.tools.run("peek.server", {})).toEqual({
      name: "server",
      instances: [{ values: { rows: 3 } }],
    });
  });

  it("reports a read that throws for its instance only", async () => {
    const ayme = started();
    peek(
      ayme,
      () => {
        throw new Error("The store is not ready.");
      },
      "rows",
      "broken"
    );
    peek(ayme, () => Promise.reject(new Error("Query failed.")), "rows", "db");
    peek(ayme, () => ({ ok: true }), "rows", "fine");

    expect(await ayme.tools.run("peek.rows", {})).toEqual({
      name: "rows",
      instances: [
        { id: "broken", error: "The store is not ready." },
        { id: "db", error: "Query failed." },
        { id: "fine", values: { ok: true } },
      ],
    });
  });

  it("withdraws the tool when its last instance goes", async () => {
    const ayme = started();
    const removeA = ayme.peek(() => "a", "list", "a");
    const removeB = ayme.peek(() => "b", "list", "b");
    const heard = heardLists(ayme);

    removeA();
    await nextTurn();
    expect(await ayme.tools.run("peek.list", {})).toEqual({
      name: "list",
      instances: [{ id: "b", values: "b" }],
    });
    expect(heard).toEqual([]);

    removeB();
    await expect.poll(() => toolNames(ayme)).not.toContain("peek.list");
    expect(heard.at(-1)).not.toContain("peek.list");
    await expect(ayme.tools.run("peek.list", {})).rejects.toThrow(
      RuntimeStateError
    );
  });

  it("keeps the tool when its last instance goes and comes back in one turn", async () => {
    const ayme = started();
    const remove = ayme.peek(() => 1, "strict", "component");
    const heard = heardLists(ayme);

    // React StrictMode runs an effect's cleanup and setup again in one go.
    remove();
    peek(ayme, () => 2, "strict", "component");
    await nextTurn();

    expect(heard).toEqual([]);
    expect(toolNames(ayme)).toContain("peek.strict");
    expect(await ayme.tools.run("peek.strict", {})).toEqual({
      name: "strict",
      instances: [{ id: "component", values: 2 }],
    });
  });

  it("announces a Peek Tool when its first instance comes", () => {
    const ayme = started();
    const heard = heardLists(ayme);

    peek(ayme, () => 1, "late");

    expect(heard.at(-1)).toContain("peek.late");
  });

  it("lists a Peek added before the session started once it starts", async () => {
    const ayme = createAyme({ pageFactory: () => page, inspector: true });
    peek(ayme, () => ({ ready: true }), "boot");
    expect(ayme.tools.list()).toEqual([]);

    cleanups.push(ayme.start());

    expect(toolNames(ayme)).toContain("peek.boot");
  });

  it.each([
    ["an empty name", ""],
    ["no name", undefined],
  ])("throws for %s", (_, name) => {
    const ayme = started();

    expect(() => ayme.peek(() => 1, name as unknown as string)).toThrow(
      RuntimeStateError
    );
  });
});

describe("the dev gate", () => {
  it("does nothing without agentConnection or inspector", async () => {
    const ayme = started({});
    const remove = peek(ayme, () => ({ secret: true }), "internals");

    expect(remove).toBeTypeOf("function");
    expect(toolNames(ayme)).not.toContain("peek.internals");
    await expect(ayme.tools.run("peek.internals", {})).rejects.toThrow(
      RuntimeStateError
    );
  });

  it("adds nothing another session with the gate on would list", () => {
    const production = createAyme({ pageFactory: () => page });
    peek(production, () => ({ secret: true }), "internals");

    expect(toolNames(started({ inspector: true }))).not.toContain(
      "peek.internals"
    );
  });

  it("still requires a name", () => {
    const ayme = started({});

    expect(() => ayme.peek(() => 1, "")).toThrow(RuntimeStateError);
  });

  it.each([
    ["agentConnection", { agentConnection: true }],
    ["inspector", { inspector: true }],
    ["the Inspector's demo", { inspector: { demo: true } }],
  ] as const)("lets Peeks live with %s on", async (_, options) => {
    const ayme = started(options);
    peek(ayme, () => 1, "gate");

    expect(toolNames(ayme)).toContain("peek.gate");
    expect(await ayme.tools.run("peek.gate", {})).toEqual({
      name: "gate",
      instances: [{ values: 1 }],
    });
  });
});

describe("where Peek Tools appear", () => {
  it("offers them to the Agent Connection's page client", async () => {
    const ayme = started({ agentConnection: true });
    peek(ayme, () => ({ open: true }), "menu");

    await expect.poll(() => connected.sessions).toHaveLength(1);
    const [client] = connected.sessions as Pick<Ayme, "tools">[];
    expect(client!.tools.list().map(({ name }) => name)).toContain("peek.menu");
  });

  it("leaves them out of WebMCP publication", async () => {
    const ayme = started({ agentConnection: true });
    peek(ayme, () => ({ open: true }), "menu");
    const published = new Map<string, unknown>();
    const publication = await synchronizeWebMcpTools({
      async registerTool(tool: { name: string }) {
        published.set(tool.name, tool);
      },
    } as never);
    cleanups.push(publication.dispose);

    expect(toolNames(ayme)).toContain("peek.menu");
    expect(published.has("snapshot")).toBe(true);
    expect(
      [...published.keys()].filter((name) => name.startsWith("peek."))
    ).toEqual([]);

    peek(ayme, () => 1, "later");
    await nextTurn();
    expect(
      [...published.keys()].filter((name) => name.startsWith("peek."))
    ).toEqual([]);
  });

  it("never offers them to the Goal Loop", async () => {
    const offered: string[][] = [];
    const goalLoop: GoalLoopDecisionFunction = async (
      request: DecisionRequest
    ) => {
      const { operation } = request.questions as {
        operation: { criteria: Record<string, string> };
      };
      offered.push(Object.keys(operation.criteria));
      return {
        model: "fake",
        answers: {
          operation: {
            type: "choice",
            choice: "none",
            confidence: 1,
            probabilities: { none: 1 },
          },
          goal_met: { type: "noul", noul: 0.9 },
        },
      };
    };
    const ayme = started({ agentConnection: true, goalLoop });
    peek(ayme, () => 1, "counter");

    await ayme.tools.run("goal", { goal: "Read the counter.", maxSteps: 1 });

    expect(offered).toHaveLength(1);
    expect(offered[0]).toContain("click");
    expect(offered[0]!.filter((key) => key.startsWith("peek."))).toEqual([]);
  });
});

describe("calling a Peek Tool", () => {
  const save: ToolManifest = {
    methodName: "save",
    toolName: "Editor.save",
    description: "Save.",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
      additionalProperties: false,
    },
    parameters: [],
  };
  const reveal: ToolManifest = {
    ...save,
    methodName: "reveal",
    toolName: "Toolbar.reveal",
  };
  const root = {
    memberName: "root",
    kind: "locator",
    access: "field",
  } as const;

  /** Adds the editor's `main`, with something in it to see. */
  function addMain() {
    const main = document.createElement("main");
    main.textContent = "Editor";
    document.body.append(main);
  }

  /** A Page Object on `main`, which is not on the page yet. */
  class Editor {
    root = page.locator("main");
    save() {}
  }
  registerCompiledPom(Editor, {
    className: "Editor",
    members: [root],
    components: [],
    tools: [save],
  });

  /** A Page Object whose action adds `main`. */
  class Toolbar {
    root = page.locator("body");
    reveal() {
      addMain();
    }
  }
  registerCompiledPom(Toolbar, {
    className: "Toolbar",
    members: [root],
    components: [],
    tools: [reveal],
  });

  it("answers without waiting for the page to settle, like snapshot", async () => {
    const ayme = started();
    ayme.pom.register(Editor);
    ayme.pom.register(Toolbar);
    cleanups.push(() => {
      ayme.pom.unregister(Editor);
      ayme.pom.unregister(Toolbar);
    });
    await expect.poll(() => toolNames(ayme)).toContain("Toolbar.reveal");
    expect(toolNames(ayme)).not.toContain("Editor.save");

    // An action's call resolves once the tools reflect the page it changed.
    await ayme.tools.run("Toolbar.reveal", {});
    expect(toolNames(ayme)).toContain("Editor.save");

    document.querySelector("main")!.remove();
    await expect.poll(() => toolNames(ayme)).not.toContain("Editor.save");

    // A Peek Tool's call does not wait for that.
    peek(
      ayme,
      () => {
        addMain();
        return "revealed";
      },
      "reveal"
    );
    await ayme.tools.run("peek.reveal", {});
    expect(toolNames(ayme)).not.toContain("Editor.save");
    await expect.poll(() => toolNames(ayme)).toContain("Editor.save");
  });

  it("waits for an action started before it, then answers without a settle wait of its own", async () => {
    const ayme = started();
    document.body.innerHTML = "<button>Save</button>";
    let saved = false;
    // The save lands a moment after the click, within the Settled Page's
    // quiet window, so the action's turn lasts until it has.
    document.querySelector("button")!.addEventListener("click", () => {
      setTimeout(() => {
        saved = true;
        document.body.append("Saved");
      }, 100);
    });
    peek(ayme, () => ({ saved }), "draft");

    let actionDoneAt = 0;
    const action = ayme.tools
      .run("click", { target: "role=button[name='Save']" })
      .then(() => {
        actionDoneAt = performance.now();
      });
    const read = await ayme.tools.run("peek.draft", {});
    const readDoneAt = performance.now();
    await action;

    expect(read).toEqual({
      name: "draft",
      instances: [{ values: { saved: true } }],
    });
    // A settle wait lasts at least the quiet window (250 ms).
    expect(readDoneAt - actionDoneAt).toBeLessThan(200);
  });
});
