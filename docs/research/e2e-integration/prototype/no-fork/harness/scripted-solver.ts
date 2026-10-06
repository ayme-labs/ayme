/**
 * A model-free stand-in for the agent: plays "create a project named {name}"
 * the way a model would. The stock arm clicks through the form, finding the
 * controls by role and a loose name (so a renamed button is still found);
 * the ayme arm calls the page object tool, or clicks when told the stored
 * call just failed.
 */

import type { ExecutorNode } from "e2e";
import type { SolveStep, Solver } from "../src/index.ts";
import { describeNode } from "../src/describe.ts";

const POM_TOOL = "ProjectsPage_createProject";

function find(
  node: ExecutorNode | undefined,
  matches: (node: ExecutorNode) => boolean
): ExecutorNode | undefined {
  if (node === undefined) return undefined;
  if (matches(node)) return node;
  for (const child of node.children ?? []) {
    const found = find(child, matches);
    if (found !== undefined) return found;
  }
  return undefined;
}

async function tapFound(
  step: SolveStep,
  what: string,
  matches: (node: ExecutorNode) => boolean,
  act: (id: string) => Promise<void>,
  verb: string
) {
  const node = find((await step.ctx.observe({ tree: true })).tree, matches);
  if (node === undefined) throw new Error(`no ${what} on screen`);
  const target = await describeNode(step.ctx, node.id);
  await act(node.id);
  step.recordGrammar(verb, target);
}

async function createByClicks(step: SolveStep, name: string): Promise<void> {
  const { actions } = step.ctx;
  await tapFound(
    step,
    "new-project button",
    (n) =>
      n.role === "button" && /\b(new|add)\b.*\bproject\b/i.test(n.name ?? ""),
    (id) => actions.tap({ id }),
    "tap"
  );
  await tapFound(
    step,
    "project name field",
    (n) => n.role === "textbox" && /project name/i.test(n.name ?? ""),
    (id) => actions.type({ id }, name),
    "type"
  );
  await tapFound(
    step,
    "create button",
    (n) => n.role === "button" && /^create( project)?$/i.test(n.name ?? ""),
    (id) => actions.tap({ id }),
    "tap"
  );
}

export function scriptedSolver(arm: "stock" | "ayme"): Solver {
  return {
    name: `scripted-${arm}`,
    async solve(step) {
      const name = step.ctx.step.params?.["name"];
      if (typeof name !== "string") {
        return {
          verdict: {
            status: "blocked",
            errorCode: "AUTOMATION_UNSUPPORTED",
            summary: 'only "create a project named {name}" is scripted',
          },
        };
      }
      const usePageObject = arm === "ayme" && step.note === undefined;
      if (usePageObject) await step.callTool(POM_TOOL, { name });
      else await createByClicks(step, name);
      return {
        verdict: { status: "passed", summary: `created project ${name}` },
        log: {
          path: usePageObject
            ? "page-object"
            : step.note === undefined
              ? "clicks"
              : "note-then-clicks",
        },
      };
    },
  };
}
