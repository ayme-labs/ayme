import { afterEach, expect, it, vi } from "vitest";

import { createPage } from "./browserPage";
import type { Page } from "@playwright/test";

import { registerCompiledPom } from "./registry";
import { callers } from "./run";
import { createAyme, getAppProcessTools, type AymeOptions } from "./runtime";

// Runtime seam: the tools of the App Processes paired beside the page, as
// the started session's page client hands them over, for the Inspector.

type Tool = { name: string; description: string; inputSchema: object };

// The page client loads as a stand-in whose App Process tools the test
// sets, and whose `run` the test answers.
const client = vi.hoisted(() => {
  let tools: readonly Tool[] = [];
  const listeners = new Set<(tools: readonly Tool[]) => void>();
  return {
    run: vi.fn<(name: string, input: unknown) => Promise<unknown>>(),
    disposed: 0,
    set(next: readonly Tool[]) {
      tools = next;
      for (const listener of listeners) listener(tools);
    },
    processTools: {
      list: () => tools,
      subscribe(listener: (tools: readonly Tool[]) => void) {
        listeners.add(listener);
        return () => void listeners.delete(listener);
      },
      run: (name: string, input: unknown) => client.run(name, input),
    },
    reset() {
      tools = [];
      listeners.clear();
      client.run.mockReset();
      client.disposed = 0;
    },
  };
});
vi.mock("./agentConnection", () => ({
  loadAgentConnection: async () => ({
    startAgentConnection: () => ({
      dispose() {
        client.disposed += 1;
      },
      processTools: client.processTools,
    }),
  }),
  loadProcessConnection: async () => ({
    startAgentConnection: () => ({ dispose() {} }),
  }),
}));

/** A Page Object whose `save` waits until the test lets it click Save. */
class SaveForm {
  static waiting = false;
  static proceed = () => {};
  readonly saveButton;
  constructor(page: Page) {
    this.saveButton = page.getByRole("button", { name: "Save" });
  }
  async save() {
    SaveForm.waiting = true;
    await new Promise<void>((resolve) => (SaveForm.proceed = resolve));
    SaveForm.waiting = false;
    await this.saveButton.click();
  }
}

registerCompiledPom(SaveForm, {
  className: "SaveForm",
  members: [{ memberName: "saveButton", kind: "locator", access: "field" }],
  tools: [
    {
      methodName: "save",
      toolName: "SaveForm.save",
      description: "Save the form.",
      inputSchema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      parameters: [],
    },
  ],
  components: [],
});

const page = createPage();
const jobs: Tool = {
  name: "peek.node.jobs",
  description: 'Read the current values of the Peek "jobs".',
  inputSchema: { type: "object" },
};

let cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.reverse()) cleanup();
  cleanups = [];
  client.reset();
});

function started(options: AymeOptions = { agentConnection: true }) {
  const ayme = createAyme({ pageFactory: () => page, ...options });
  cleanups.push(ayme.start());
  return ayme;
}

const names = (tools: readonly { name: string }[]) =>
  tools.map(({ name }) => name);

it("lists the App Processes' tools the page client hands over, and announces each change", async () => {
  const ayme = started();
  const processTools = getAppProcessTools(ayme);
  const heard: string[][] = [];
  processTools.subscribe((tools) => heard.push(names(tools)));

  client.set([jobs]);

  await vi.waitFor(() =>
    expect(names(processTools.list())).toEqual(["peek.node.jobs"])
  );
  expect(heard.at(-1)).toEqual(["peek.node.jobs"]);
});

it("runs an App Process's tool through the page client", async () => {
  const ayme = started();
  client.run.mockResolvedValue({ name: "jobs", instances: [] });
  client.set([jobs]);
  const processTools = getAppProcessTools(ayme);
  await vi.waitFor(() => expect(processTools.list()).toHaveLength(1));

  const result = await processTools.run("peek.node.jobs", {});

  expect(result).toEqual({ name: "jobs", instances: [] });
  expect(client.run).toHaveBeenCalledExactlyOnceWith("peek.node.jobs", {});
});

it("records a run from the page as a Run in the page's log, for the Caller that names itself", async () => {
  const ayme = started();
  client.run.mockResolvedValue({ name: "jobs", instances: [] });
  client.set([jobs]);
  const processTools = getAppProcessTools(ayme);
  await vi.waitFor(() => expect(processTools.list()).toHaveLength(1));
  const before = new Set(ayme.runs.list().map((run) => run.id));

  await processTools.run("peek.node.jobs", {}, { by: callers.inspector });
  client.run.mockRejectedValue(new Error("The App Process went away."));
  await processTools.run("peek.node.jobs", {}).catch(() => {});

  expect(ayme.runs.list().filter((run) => !before.has(run.id))).toEqual([
    expect.objectContaining({
      tool: "peek.node.jobs",
      input: {},
      by: callers.inspector,
      status: "succeeded",
      result: { name: "jobs", instances: [] },
    }),
    expect.objectContaining({
      tool: "peek.node.jobs",
      by: callers.app,
      status: "failed",
      error: "The App Process went away.",
    }),
  ]);
});

it("records no Interactions on an App Process tool's Run, even while a page Run acts", async () => {
  document.body.innerHTML = "<main><button>Save</button></main>";
  const ayme = started();
  ayme.pom.register(SaveForm);
  cleanups.push(() => {
    ayme.pom.unregister(SaveForm);
    document.body.innerHTML = "";
  });
  await ayme.tools.run("snapshot", {});
  let answer: (value: unknown) => void = () => {};
  client.run.mockImplementation(
    () => new Promise((resolve) => (answer = resolve))
  );
  client.set([jobs]);
  const processTools = getAppProcessTools(ayme);
  await vi.waitFor(() => expect(processTools.list()).toHaveLength(1));
  const before = new Set(ayme.runs.list().map((run) => run.id));

  // The page Run waits; the App Process tool starts; the page Run clicks.
  const saved = ayme.tools.run("SaveForm.save", {});
  await vi.waitFor(() => expect(SaveForm.waiting).toBe(true));
  const inProcess = processTools.run(
    "peek.node.jobs",
    {},
    { by: callers.inspector }
  );
  SaveForm.proceed();
  await saved;
  answer({ name: "jobs", instances: [] });
  await inProcess;

  expect(ayme.runs.list().filter((run) => !before.has(run.id))).toEqual([
    expect.objectContaining({
      tool: "SaveForm.save",
      interactions: [expect.objectContaining({ operation: "click" })],
    }),
    expect.objectContaining({ tool: "peek.node.jobs", interactions: [] }),
  ]);
});

it("lists none once the session stops, and announces it", async () => {
  const ayme = createAyme({ pageFactory: () => page, agentConnection: true });
  const stop = ayme.start();
  client.set([jobs]);
  const processTools = getAppProcessTools(ayme);
  await vi.waitFor(() => expect(processTools.list()).toHaveLength(1));
  const heard: string[][] = [];
  processTools.subscribe((tools) => heard.push(names(tools)));

  stop();

  expect(processTools.list()).toEqual([]);
  expect(heard).toEqual([[]]);
});

it("lists none, and runs none, without the Agent Connection, recording the Run as failed", async () => {
  const ayme = started({ inspector: false });
  client.set([jobs]);
  const before = new Set(ayme.runs.list().map((run) => run.id));

  expect(getAppProcessTools(ayme).list()).toEqual([]);
  await expect(
    getAppProcessTools(ayme).run("peek.node.jobs", {})
  ).rejects.toThrow("No Ayme MCP server is paired with this page.");
  expect(ayme.runs.list().filter((run) => !before.has(run.id))).toEqual([
    expect.objectContaining({
      tool: "peek.node.jobs",
      by: callers.app,
      status: "failed",
      error: "RuntimeStateError: No Ayme MCP server is paired with this page.",
    }),
  ]);
});
