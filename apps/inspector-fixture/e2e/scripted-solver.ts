/**
 * A model-free stand-in for the agent on the dogfood page. Each step the
 * tests take is scripted twice: the ayme arm calls the Inspector tool the
 * step should cache, the stock arm clicks through the panel, finding the
 * controls by role and name in e2e's observation (which walks the Inspector's
 * open shadow root). The ayme arm clicks too when a step has no tool among
 * those offered, or when told the stored call just failed.
 *
 * The tool names are Ayme's, with `_` for `.`: `Inspector_tool`,
 * `Inspector_navigator_showLens`. A step whose tool `aymeTools` does not
 * offer (a collection member's action) clicks.
 */

import type { JsonValue } from "e2e";
import type { ExecutorNode } from "e2e";
import type { SolveStep, Solver } from "@ayme-dev/e2e";

type Matcher = (node: ExecutorNode) => boolean;

/** One scripted step: the instruction's shape, its tool call, and its clicks. */
interface Script {
  readonly instruction: RegExp;
  readonly tool?: (params: Params) => {
    readonly name: string;
    readonly args: JsonValue;
  };
  readonly clicks: (step: SolveStep, params: Params) => Promise<void>;
}

type Params = Readonly<Record<string, unknown>>;

const byRole =
  (role: string, name: RegExp | string): Matcher =>
  (node) =>
    node.role === role &&
    (typeof name === "string"
      ? node.name === name
      : name.test(node.name ?? ""));

function find(
  node: ExecutorNode | undefined,
  matches: Matcher
): ExecutorNode | undefined {
  if (node === undefined) return undefined;
  if (matches(node)) return node;
  for (const child of node.children ?? []) {
    const found = find(child, matches);
    if (found !== undefined) return found;
  }
  return undefined;
}

/** Observes the screen and finds one control, inside a container when given. */
async function locate(
  step: SolveStep,
  what: string,
  matches: Matcher,
  within?: Matcher
): Promise<ExecutorNode> {
  const { tree } = await step.ctx.observe({ tree: true });
  const scope = within === undefined ? tree : find(tree, within);
  const node = find(scope, matches);
  if (node === undefined) throw new Error(`no ${what} on screen`);
  return node;
}

async function tap(
  step: SolveStep,
  what: string,
  matches: Matcher,
  within?: Matcher
) {
  const node = await locate(step, what, matches, within);
  await step.ctx.actions.tap({ id: node.id });
  step.recordGrammar("tap", { role: node.role, name: node.name });
}

async function type(
  step: SolveStep,
  what: string,
  matches: Matcher,
  value: string,
  within?: Matcher
) {
  const node = await locate(step, what, matches, within);
  await step.ctx.actions.type({ id: node.id }, value);
  step.recordGrammar("type", { role: node.role, name: node.name });
}

const text = (params: Params, key: string): string => {
  const value = params[key];
  if (typeof value !== "string")
    throw new Error(`the step needs a string parameter "${key}"`);
  return value;
};

const inRuns = byRole("region", "Runs");
const inLensGroup = byRole("group", "Lens");

const SCRIPTS: readonly Script[] = [
  {
    instruction: /^collapse the panel to its logo$/,
    tool: () => ({ name: "Inspector_collapse", args: {} }),
    clicks: (step) =>
      tap(step, "collapse button", byRole("button", "Collapse inspector")),
  },
  {
    instruction: /^open the panel$/,
    tool: () => ({ name: "Inspector_open", args: {} }),
    clicks: (step) => tap(step, "logo", byRole("button", "Open ayme")),
  },
  {
    instruction: /^show the \{lens\} lens$/,
    tool: (params) => ({
      name: "Inspector_navigator_showLens",
      args: { name: text(params, "lens") },
    }),
    clicks: (step, params) =>
      tap(
        step,
        `${text(params, "lens")} lens button`,
        byRole("button", text(params, "lens")),
        inLensGroup
      ),
  },
  {
    instruction: /^search the active lens for \{query\}$/,
    tool: (params) => ({
      name: "Inspector_navigator_search",
      args: { query: text(params, "query") },
    }),
    clicks: (step, params) =>
      type(
        step,
        "navigator search box",
        (node) => node.role === "searchbox",
        text(params, "query")
      ),
  },
  {
    instruction: /^open the \{tool\} tool's page from the Tools lens$/,
    tool: (params) => ({
      name: "Inspector_tool",
      args: { name: text(params, "tool") },
    }),
    clicks: async (step, params) => {
      // As `Inspector.tool` does: the Tools lens, an empty search (a search
      // result for an action opens its model's page, not the tool's), then
      // the entry.
      const tool = text(params, "tool");
      await tap(
        step,
        "Tools lens button",
        byRole("button", "Toolbox"),
        inLensGroup
      );
      await type(
        step,
        "navigator search box",
        (node) => node.role === "searchbox",
        ""
      );
      await tap(step, `${tool} entry`, byRole("button", tool));
    },
  },
  {
    // Running a card is not a tool (RunCard.run carries no `@ayme.action`), so
    // this step is clicks on both arms and e2e's own cache replays it.
    instruction: /^run it with the text \{text\}$/,
    clicks: async (step, params) => {
      await type(
        step,
        "text field",
        byRole("textbox", "text"),
        text(params, "text")
      );
      await tap(step, "Run button", byRole("button", "Run"));
    },
  },
  {
    instruction: /^clear the runs$/,
    tool: () => ({ name: "Inspector_runs_clear", args: {} }),
    // The list app has a Clear button too: this one is inside Runs.
    clicks: (step) =>
      tap(step, "Runs' Clear button", byRole("button", "Clear"), inRuns),
  },
  {
    instruction: /^collapse the Page object models pane$/,
    tool: () => ({
      name: "Inspector_navigator_model_togglePane",
      args: { name: "Page object models" },
    }),
    clicks: (step) =>
      tap(
        step,
        "Page object models pane toggle",
        byRole("button", /^Page object models · \d+$/)
      ),
  },
];

export function scriptedSolver(arm: "stock" | "ayme"): Solver {
  return {
    name: `scripted-${arm}`,
    async solve(step) {
      const { instruction, params = {} } = step.ctx.step;
      const script = SCRIPTS.find((candidate) =>
        candidate.instruction.test(instruction)
      );
      if (script === undefined) {
        return {
          verdict: {
            status: "blocked",
            errorCode: "AUTOMATION_UNSUPPORTED",
            summary: `no script for "${instruction}"`,
          },
        };
      }
      const call = script.tool?.(params);
      const offered =
        call !== undefined &&
        step.tools[call.name] !== undefined &&
        (step.available === undefined || step.available.has(call.name));
      const usePageObject =
        arm === "ayme" && offered && step.note === undefined;
      if (usePageObject) await step.callTool(call.name, call.args);
      else await script.clicks(step, params);
      return {
        verdict: { status: "passed", summary: `did "${instruction}"` },
        log: {
          path: usePageObject
            ? "page-object"
            : step.note !== undefined
              ? "note-then-clicks"
              : call !== undefined && arm === "ayme"
                ? "tool-not-offered-clicks"
                : "clicks",
        },
      };
    },
  };
}
