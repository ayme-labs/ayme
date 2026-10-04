import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { DecisionRequest, DecisionResponse } from "./decisionTypes";
import { createPage } from "./browserPage";
import type { GoalLoopDecisionFunction } from "./goalLoop";
import { createAyme, type Ayme } from "./runtime";
import { synchronizeWebMcpTools } from "./webMcp";

type PublishedTool = {
  name: string;
  execute(input: unknown): Promise<unknown>;
};

// The test document's first history entry: no test can go back from it.
const firstEntry = navigation.currentEntry!;

/** The operations the Goal Loop last offered its model. */
let offered: string[] = [];

describe("navigate_back, navigate_forward and reload, in Chromium", () => {
  let ayme: Ayme;
  let published: Map<string, PublishedTool>;
  let stop: () => void;
  let disposePublication: () => void;
  let listening: AbortController;

  /** The app opens `title` as a new history entry of the same document. */
  function open(title: string) {
    history.pushState({ title }, "");
    document.querySelector("h1")!.textContent = title;
  }

  beforeEach(async () => {
    document.body.innerHTML = `<main><h1>Start page</h1></main>`;
    history.replaceState({ title: "Start page" }, "");
    listening = new AbortController();
    // The app's router renders the entry the history moved to.
    window.addEventListener(
      "popstate",
      (event: PopStateEvent) => {
        document.querySelector("h1")!.textContent = (
          event.state as { title: string }
        ).title;
      },
      { signal: listening.signal }
    );
    ayme = createAyme({
      pageFactory: () => createPage({ actionTimeout: 500 }),
      goalLoop: recordingOperations(["navigate_back", "navigate_forward"]),
    });
    stop = ayme.start();
    published = new Map();
    disposePublication = (
      await synchronizeWebMcpTools({
        async registerTool(tool: PublishedTool) {
          published.set(tool.name, tool);
        },
      })
    ).dispose;
  });

  afterEach(async () => {
    listening.abort();
    disposePublication();
    stop();
    if (navigation.currentEntry!.key !== firstEntry.key)
      await navigation.traverseTo(firstEntry.key).finished;
    document.body.innerHTML = "";
  });

  /** Call a published tool as the calling agent. */
  function call(name: string, input: unknown) {
    const tool = published.get(name);
    if (!tool) throw new Error(`Tool ${name} was not published.`);
    return tool.execute(input);
  }

  const heading = () => document.querySelector("h1")!.textContent;

  it("reports that nothing happened when there is no entry to go back to", async () => {
    expect(navigation.canGoBack).toBe(false);
    await call("snapshot", {});
    await expect(call("navigate_back", {})).resolves.toEqual({
      result: "There is no history entry to go back to; the page did not move.",
      page_changed: false,
      settled: true,
    });
    expect(navigation.currentEntry!.key).toBe(firstEntry.key);
  });

  it("reports that nothing happened when there is no entry to go forward to", async () => {
    open("Settings");
    await call("snapshot", {});
    await expect(call("navigate_forward", {})).resolves.toEqual({
      result:
        "There is no history entry to go forward to; the page did not move.",
      page_changed: false,
      settled: true,
    });
    expect(heading()).toBe("Settings");
  });

  it("goes back and forward over the app's entries with Change Records, staying in the document", async () => {
    open("Settings");
    await call("snapshot", {});

    await expect(call("navigate_back", {})).resolves.toEqual({
      page_changed: true,
      settled: true,
      changes: expect.stringContaining("Start page"),
    });
    expect(heading()).toBe("Start page");

    await expect(call("navigate_forward", {})).resolves.toEqual({
      page_changed: true,
      settled: true,
      changes: expect.stringContaining("Settings"),
    });
    expect(heading()).toBe("Settings");
  });

  it("publishes all three as Browser Tools", () => {
    for (const name of ["navigate_back", "navigate_forward", "reload"])
      expect(ayme.tools.list()).toContainEqual(
        expect.objectContaining({ name, group: "browser" })
      );
  });

  it("offers all three to the Goal Loop, which runs them", async () => {
    open("Settings");
    await expect(
      call("goal", { goal: "go back, then forward again", maxSteps: 2 })
    ).resolves.toMatchObject({
      history: [
        { operation: "navigate_back", result: "ok", page_changed: true },
        { operation: "navigate_forward", result: "ok", page_changed: true },
      ],
    });
    expect(heading()).toBe("Settings");
    for (const name of ["navigate_back", "navigate_forward", "reload"])
      expect(offered).toContain(name);
  });
});

/**
 * A decision function that runs the listed operations, one per step, and
 * records the operations it was offered.
 */
function recordingOperations(steps: string[]): GoalLoopDecisionFunction {
  let step = 0;
  return async (request: DecisionRequest): Promise<DecisionResponse> => {
    const { criteria } = request.questions.operation as {
      criteria: Record<string, string>;
    };
    offered = Object.keys(criteria);
    return {
      model: request.model,
      answers: {
        operation: {
          type: "choice",
          choice: steps[Math.min(step++, steps.length - 1)]!,
          confidence: 1,
        },
        goal_met: { type: "noul", noul: 0.1 },
      },
    };
  };
}
