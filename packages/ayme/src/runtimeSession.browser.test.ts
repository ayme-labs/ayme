import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createPage,
  createAyme,
  type DecisionRequest,
  type DecisionResponse,
  type Handover,
  type CustomTool,
  type Ayme,
} from "./index";

type Criteria = Record<string, string>;
type Questions = Record<string, { criteria?: Criteria }>;

/** One choice answer: the first option the predicate accepts. */
function choose(
  criteria: Criteria,
  accept: (key: string, description: string) => boolean
) {
  const chosen = Object.entries(criteria).find(([key, description]) =>
    accept(key, description)
  );
  if (!chosen)
    throw new Error(`No fitting option among ${JSON.stringify(criteria)}`);
  const probabilities = Object.fromEntries(
    Object.keys(criteria).map((key) => [key, key === chosen[0] ? 1 : 0])
  );
  return { type: "choice", choice: chosen[0], confidence: 1, probabilities };
}

/**
 * A scripted System One model: step one highlights the save button, step two
 * judges the goal met.
 */
function scriptedGoalLoop() {
  let step = 0;
  return async (request: DecisionRequest): Promise<DecisionResponse> => {
    const questions = request.questions as Questions;
    if (questions.operation?.criteria) {
      const first = step++ === 0;
      return {
        model: "typesafe/jev-1.13",
        answers: {
          operation: choose(
            questions.operation.criteria,
            (key) => key === (first ? "highlight_element" : "none")
          ),
          goal_met: { type: "noul", noul: first ? 0.1 : 0.9 },
        },
      };
    }
    return {
      model: "typesafe/jev-1.13",
      answers: {
        ref: choose(questions.ref!.criteria!, (_key, description) =>
          description.includes("Save changes")
        ),
      },
    };
  };
}

describe("the public runtime session in Chromium", () => {
  let stop: (() => void) | undefined;

  afterEach(() => {
    stop?.();
    stop = undefined;
    document.body.innerHTML = "";
  });

  it("runs the Goal Loop with a caller page factory and a Custom Tool, without publication or a driver", async () => {
    document.body.innerHTML = `<main><button>Save changes</button></main>`;
    expect("modelContext" in document).toBe(false);
    const highlight: CustomTool = {
      name: "highlight_element",
      description: "Highlight one element on the page.",
      async execute({ element }) {
        element.classList.add("highlighted");
        return null;
      },
    };
    const pageFactory = vi.fn(() => createPage({ actionTimeout: 500 }));
    const session: Ayme = createAyme({
      pageFactory,
      customTools: [highlight],
      goalLoop: scriptedGoalLoop(),
    });
    expect(pageFactory).not.toHaveBeenCalled();
    expect(session.webMCP.publicationStatus.state).toBe("disabled");

    stop = session.start();
    expect(pageFactory).toHaveBeenCalledOnce();
    const handover: Handover = await session.tools.run("goal", {
      goal: "highlight the save button",
      maxSteps: 3,
    });

    expect(handover).toMatchObject({
      reason: "done",
      history: [
        {
          operation: "highlight_element",
          chosen: {
            ref: {
              key: expect.any(String),
              description: 'button "Save changes"',
            },
          },
          result: "ok",
        },
      ],
    });
    expect(
      document.querySelector("button")?.classList.contains("highlighted")
    ).toBe(true);
    expect(pageFactory).toHaveBeenCalledOnce();
    expect(session.webMCP.publicationStatus.state).toBe("disabled");
    expect("modelContext" in document).toBe(false);
  });
});
