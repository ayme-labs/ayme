import { afterEach, describe, expect, it } from "vitest";
import {
  callers,
  createAyme,
  createPage,
  type Ayme,
  type CustomTool,
  type Run,
} from "./index";
import type { GoalLoopDecisionFunction } from "./goalLoop";

// Runtime object seam: a tool starts child Runs through the `run` in its
// context; `ayme.runs` lists them under the Run that started them.

const SAVE = { target: "role=button[name='Save']" };

describe("child Runs, in Chromium", () => {
  let ayme: Ayme;
  let stop: (() => void) | undefined;

  afterEach(() => {
    stop?.();
    stop = undefined;
    document.body.innerHTML = "";
  });

  function start(options: Parameters<typeof createAyme>[0] = {}) {
    document.body.innerHTML = "<main><button>Save</button></main>";
    ayme = createAyme({ pageFactory: () => createPage(), ...options });
    stop = ayme.start();
  }

  /** The Runs this test started, past the ones earlier tests left. */
  function runsSince(before: readonly Run[]): readonly Run[] {
    const earlier = new Set(before.map((run) => run.id));
    return ayme.runs.list().filter((run) => !earlier.has(run.id));
  }

  async function refOf(name: string): Promise<string> {
    const { structure } = await ayme.tools.run("snapshot", {});
    const ref = structure.match(new RegExp(`(e\\d+) button "${name}"`))?.[1];
    if (!ref) throw new Error(`Expected a Structural Ref for ${name}.`);
    return ref;
  }

  it("lists the Runs a Custom Tool starts through its context's run as its children, with no Caller", async () => {
    const saveTwice: CustomTool = {
      name: "save_twice",
      description: "Save twice.",
      async execute(target, { run }) {
        await run("click", { target: target.ref });
        await run("click", SAVE);
        return "saved twice";
      },
    };
    start({ customTools: [saveTwice] });
    const ref = await refOf("Save");
    const before = ayme.runs.list();

    await ayme.tools.run("save_twice", { ref }, { by: "support-assistant" });

    const [parent, ...children] = runsSince(before);
    expect(parent).toMatchObject({
      tool: "save_twice",
      by: "support-assistant",
      status: "succeeded",
    });
    expect(parent).not.toHaveProperty("parent");
    expect(children).toEqual([
      expect.objectContaining({
        tool: "click",
        input: { target: ref },
        parent: parent!.id,
        status: "succeeded",
      }),
      expect.objectContaining({
        tool: "click",
        input: SAVE,
        parent: parent!.id,
        status: "succeeded",
      }),
    ]);
    for (const child of children) expect(child).not.toHaveProperty("by");
    expect(children[0]!.id).not.toBe(children[1]!.id);
  });

  it("runs a tool's child Runs within its turn, before a Run started meanwhile", async () => {
    const saveTwice: CustomTool = {
      name: "save_twice",
      description: "Save twice.",
      async execute(_target, { run }) {
        await run("click", SAVE);
        await run("click", SAVE);
        return null;
      },
    };
    start({ customTools: [saveTwice] });
    const ref = await refOf("Save");
    const before = ayme.runs.list();

    await Promise.all([
      ayme.tools.run("save_twice", { ref }),
      ayme.tools.run("click", SAVE, { by: callers.inspector }),
    ]);

    expect(
      runsSince(before).map((run) => [run.tool, run.by ?? "child"])
    ).toEqual([
      ["save_twice", callers.app],
      ["click", "child"],
      ["click", "child"],
      ["click", callers.inspector],
    ]);
  });

  it("records a child Run of a tool that is not live as failed, under its parent", async () => {
    const saveElsewhere: CustomTool = {
      name: "save_elsewhere",
      description: "Save on a page that is not here.",
      async execute(_target, { run }) {
        return run("Nowhere.save", {});
      },
    };
    start({ customTools: [saveElsewhere] });
    const ref = await refOf("Save");
    const before = ayme.runs.list();

    await ayme.tools.run("save_elsewhere", { ref }).catch(() => {});

    const [parent, child] = runsSince(before);
    expect(parent).toMatchObject({ tool: "save_elsewhere", status: "failed" });
    expect(child).toMatchObject({
      tool: "Nowhere.save",
      parent: parent!.id,
      status: "failed",
      error: 'RuntimeStateError: The tool "Nowhere.save" is not live.',
    });
  });

  it("keeps the newest 200 top-level Runs with their children, and drops an older one with its children", async () => {
    const saveTwice: CustomTool = {
      name: "save_twice",
      description: "Save twice.",
      async execute(_target, { run }) {
        await run("click", SAVE);
        await run("click", SAVE);
        return null;
      },
    };
    start({ customTools: [saveTwice] });
    const ref = await refOf("Save");
    await ayme.tools.run("save_twice", { ref });
    const [first, ...children] = ayme.runs.list().slice(-3);
    for (let index = 0; index < 199; index++)
      await ayme.tools.run("snapshot", {});

    const kept = ayme.runs.list();
    expect(kept).toHaveLength(202);
    expect(kept.slice(0, 3)).toEqual([first, ...children]);

    await ayme.tools.run("snapshot", {});

    const runs = ayme.runs.list();
    expect(runs).toHaveLength(200);
    expect(runs.every((run) => run.tool === "snapshot")).toBe(true);
  });

  it("lists the Runs a goal Run's steps executed as its children", async () => {
    start({
      goalLoop: decideSteps([
        { operation: "click", target: 'button "Save"' },
        { operation: "click", target: 'button "Save"' },
        { operation: "none", goalMet: 0.9 },
      ]),
    });
    const before = ayme.runs.list();

    const handover = await ayme.tools.run("goal", {
      goal: "save twice",
      maxSteps: 5,
    });

    expect(handover).toMatchObject({ reason: "done" });
    const [goal, ...steps] = runsSince(before);
    expect(goal).toMatchObject({
      tool: "goal",
      by: callers.app,
      status: "succeeded",
    });
    expect(steps).toEqual([
      expect.objectContaining({
        tool: "click",
        parent: goal!.id,
        status: "succeeded",
      }),
      expect.objectContaining({
        tool: "click",
        parent: goal!.id,
        status: "succeeded",
      }),
    ]);
    for (const step of steps) {
      expect(step).not.toHaveProperty("by");
      expect(step.input).toMatchObject({ target: expect.any(String) });
    }
  });
});

type Step = { operation: string; target?: string; goalMet?: number };

/**
 * A fake Decision Endpoint: each step chooses `operation`, and the option
 * described as `target` for its target, and scores the goal as met by
 * `goalMet` (0.1 when absent).
 */
function decideSteps(steps: Step[]): GoalLoopDecisionFunction {
  let step = 0;
  const choice = (criteria: Record<string, string>, wanted: string) => {
    const key = Object.keys(criteria).find(
      (candidate) => candidate === wanted || criteria[candidate] === wanted
    );
    if (key === undefined)
      throw new Error(`No option ${wanted} among ${JSON.stringify(criteria)}`);
    return { type: "choice", choice: key, confidence: 1 };
  };
  return async (request) => {
    const questions = request.questions as Record<
      string,
      { criteria: Record<string, string> }
    >;
    if (!questions.operation) {
      const { target } = steps[step - 1]!;
      return {
        model: "fake",
        answers: Object.fromEntries(
          Object.entries(questions).map(([id, { criteria }]) => [
            id,
            choice(criteria, target!),
          ])
        ),
      };
    }
    const { operation, goalMet = 0.1 } = steps[step++]!;
    return {
      model: "fake",
      answers: {
        operation: choice(questions.operation.criteria, operation),
        goal_met: { type: "noul", noul: goalMet },
      },
    };
  };
}
