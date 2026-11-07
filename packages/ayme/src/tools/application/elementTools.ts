import type { Locator, Page } from "@playwright/test";
import {
  parseStructuralRef,
  selectorForRef,
  type StructuralNode,
  type StructuralTree,
} from "@ayme-dev/core/structural-observation";
import {
  assertReachable,
  refsOfLocator,
  type ElementInput,
} from "../../page-state/infrastructure";
import { refHint, selectorFailure } from "../../page-state/domain";
import { type PageStateSession } from "../../page-state/application";
import {
  toolFilterKey,
  type ElementFilter,
  type JsonSchema,
  type JsonValue,
  type ToolDescriptor,
} from "../../shared";
import type { RunContext } from "../../runs/application";
import type { ToolInput, ToolResult } from "../domain/toolTypes";
import type { AriaRef, PageStateCapture } from "../../page-state/domain";
import {
  RefResolutionError,
  RuntimeStateError,
  ToolInputError,
  type Predicate,
} from "../../shared";

/**
 * A Custom Tool: an operation an app registers that applies to one element.
 * One registration publishes it as a WebMCP Tool for the calling agent and
 * makes it an operation the Goal Loop may choose (ADR-0023).
 */
export type CustomTool = {
  name: string;
  /** The only instruction the model gets about this operation. */
  description: string;
  /**
   * The elements the Goal Loop may offer: a CSS selector, or a function the
   * session calls once with its Page, returning the Locator of them (see
   * `ElementFilter`). Omitted = every node with a ref.
   */
  filter?: ElementFilter;
  /**
   * Acts on the element `target.locator` matches, which `target.ref` names,
   * in the browser and in Node alike: no code outside the page holds an
   * element. To use other tools, start them through `run`: each is a child
   * Run of this one and runs within this Run's turn, after the child Runs
   * started before it. Never call `ayme.tools.run` from here: that Run waits
   * for this one to end, so neither ever finishes.
   */
  execute(
    target: { ref: AriaRef; locator: Locator },
    context: CustomToolContext
  ): Promise<unknown>;
};

/** What a Custom Tool's `execute` is handed besides its target. */
export type CustomToolContext = {
  /**
   * Starts a Run of the live tool `name` as a child Run of the Custom Tool's
   * Run, and returns its result. Throws Ayme's errors, as `ayme.tools.run`
   * does.
   */
  run<N extends string>(name: N, input: ToolInput<N>): Promise<ToolResult<N>>;
};

/**
 * A Browser Tool or Custom Tool, as published: `execute` runs it for a Run,
 * whose context carries the page it acts on and the cursor its Change Record
 * reads from and moves.
 */
export type PublishedElementTool = ToolDescriptor & {
  inputSchema: JsonSchema;
  execute(input: unknown, context: RunContext): Promise<JsonValue>;
};

/**
 * Package-internal: a tool that acts on one element, ready to publish, with
 * the filter it offers the Goal Loop: a Custom Tool or a single-element
 * Browser Tool (ADR-0023).
 */
export type RegisteredElementTool = {
  /** As published; the Goal Loop executes it too. */
  readonly tool: PublishedElementTool;
  /** The input field that addresses the element: `ref` or `target`. */
  readonly targetField: TargetField;
  /** The input the Goal Loop fills; publication-only options are left out. */
  readonly loopInputSchema: JsonSchema;
  /**
   * Which elements the Goal Loop may offer this tool; not enforced on direct
   * calls. For a tool that needs reach, it offers only those its input would
   * reach on the page, as `reach` measures it, which a direct call does
   * enforce.
   */
  readonly takes: ElementTake;
  /** The input the tool sends its element, which must reach it. */
  readonly needsReach?: ElementInput;
};

/**
 * Which elements a tool takes: the elements a predicate keeps, evaluated in
 * the page with the capture; every element with a ref; or, for a Custom Tool
 * that gave one, the elements its filter keeps, which the capture carries
 * under the tool's name.
 */
export type ElementTake =
  | { readonly predicate: Predicate }
  | { readonly filter: string }
  | { readonly every: true };

/**
 * Package-internal: where an element tool's filter measures reach: on
 * `page`, with the runtime's `reach`, as a Run carries them.
 */
export type ReachOn = Pick<RunContext, "page" | "reach">;

/**
 * The input field that addresses the element. A Custom Tool takes a
 * Structural Ref as `ref`; a Browser Tool takes a Structural Ref or a
 * selector as `target`, as Playwright MCP does.
 */
export type TargetField = "ref" | "target";

/** The element a call addresses, resolved for this call. */
export type ResolvedTarget = {
  /** Its current Structural Ref; absent when a selector addressed it. */
  ref?: AriaRef;
  /**
   * Its Structural Ref whichever way it was addressed: a selector's element
   * is given one, a synthetic one when no capture has named it.
   */
  elementRef: string;
  /** A selector for it, for the browser Page: `ayme-ref=…` or the one given. */
  selector: string;
};

/** What a tool does once its element is resolved. */
export type ElementToolDefinition = {
  name: string;
  description: string;
  /** Names the operation in a resolution error: `Cannot ${label} ref "e1": …`. */
  label: string;
  inputSchema: JsonSchema;
  targetField: TargetField;
  /**
   * The input the tool sends its element, which must reach it (ADR-0035,
   * ADR-0039): the Goal Loop and the Inspector offer only those elements,
   * and a call on another is refused with its Availability Reason.
   */
  needsReach?: ElementInput;
  perform(
    target: ResolvedTarget,
    input: Record<string, unknown>,
    context: RunContext
  ): Promise<unknown>;
};

/** Package-internal: the input field naming the one element a tool addresses. */
export const TARGET_SCHEMA: JsonSchema = {
  type: "string",
  description:
    "A Structural Ref from the page snapshot, or a selector that matches exactly one element.",
};

const REF_INPUT_SCHEMA: JsonSchema = {
  type: "object",
  properties: { ref: { type: "string" } },
  required: ["ref"],
  additionalProperties: false,
};

// --- The shared mechanism ---

/**
 * How a tool that acts on one element executes for a Run: resolve the
 * element (a ref through the identity ledger, ADR-0028) and hand `perform`
 * the element. Finishes with the shared action sequence, so every such tool
 * returns the same action result.
 */
function elementToolExecution(
  definition: ElementToolDefinition
): PublishedElementTool["execute"] {
  return async (input, context) => {
    const fields = input as Record<string, unknown>;
    const target = await resolveElementTarget(
      context.page,
      definition,
      fields[definition.targetField] as string,
      context.pageStateSession
    );
    if (definition.needsReach)
      await assertReachable(
        context.reach,
        context.page,
        definition.name,
        target.elementRef,
        definition.needsReach,
        (ref) => context.pageStateSession.latestRefOfNamed(ref)
      );
    return context.pageStateSession.runAction(
      context.cursor,
      {
        tool: definition.name,
        args: input,
        ...(target.ref ? { targetRef: target.ref } : {}),
      },
      () => definition.perform(target, fields, context)
    );
  };
}

/** Package-internal: register a tool so it is published and the Goal Loop may choose it. */
export function registerElementTool(
  definition: ElementToolDefinition,
  takes: ElementTake
): RegisteredElementTool {
  return {
    tool: {
      name: definition.name,
      description: definition.description,
      inputSchema: definition.inputSchema,
      execute: elementToolExecution(definition),
    },
    targetField: definition.targetField,
    loopInputSchema: requiredInputOnly(definition.inputSchema),
    takes,
    ...(definition.needsReach ? { needsReach: definition.needsReach } : {}),
  };
}

/**
 * A tool's input as the Goal Loop fills it: its required fields. The options
 * Playwright MCP adds to Browser Tools (double click, modifiers, typing
 * slowly) stay with the calling agent, so a loop step asks what it asked
 * before them. A Custom Tool's only field, `ref`, is required.
 */
function requiredInputOnly(schema: JsonSchema): JsonSchema {
  const required = new Set(schema.required ?? []);
  return {
    ...schema,
    properties: Object.fromEntries(
      Object.entries(schema.properties ?? {}).filter(([name]) =>
        required.has(name)
      )
    ),
  };
}

/**
 * A Playwright locator expression, as generate_locator returns for Page
 * Object code: `getByRole(…)`, `page.locator(…)`, `this.page.frameLocator(…)`,
 * `root.getByText(…).first()`. Tools take a Structural Ref or a selector.
 */
const LOCATOR_EXPRESSION =
  /^\s*(?:await\s+)?(?:[\w$]+\.)*(?:getBy\w+|locator|frameLocator)\(/;

/**
 * Package-internal: resolve the element one call addresses. The one place
 * that decides what a target is: a `ref` is a Structural Ref; a `target` is
 * a Structural Ref, else a selector `page` resolves, which must match
 * exactly one element. With `scope`, a selector is matched as
 * `page.locator(scope).locator(…)` matches it, and the selector returned is
 * that chain; a Structural Ref names its element wherever it is.
 */
export async function resolveElementTarget(
  page: Page,
  definition: Pick<ElementToolDefinition, "label" | "targetField">,
  requested: string,
  pageStateSession: PageStateSession,
  scope?: string
): Promise<ResolvedTarget> {
  if (definition.targetField === "ref" || parseStructuralRef(requested)) {
    const node = await pageStateSession.resolveRef(requested, definition.label);
    return {
      ref: node.ref,
      elementRef: node.ref,
      selector: selectorForRef(node.ref),
    };
  }
  const hint = refHint(requested);
  const failure = (reason: string, hint?: string) =>
    selectorFailure(definition.label, requested, reason, hint);
  // A locator expression is neither a Structural Ref nor a selector, so it
  // fails as what it is.
  if (LOCATOR_EXPRESSION.test(requested))
    throw new ToolInputError(
      failure("it is a Playwright locator expression, which tools do not take")
    );
  // Chained as Playwright's Locator.locator chains a selector.
  const selector = scope === undefined ? requested : `${scope} >> ${requested}`;
  let refs: string[];
  try {
    refs = await refsOfLocator(page, page.locator(selector));
  } catch (error) {
    // The parser's diagnosis stays; the advice Playwright ends it with goes.
    const diagnosis = (error instanceof Error ? error.message : String(error))
      .replace(/^(?:\w+\.)?\$?\$?\w+: /, "")
      .replace(/\.? Did you mean to CSS\.escape it\?$/, "");
    throw new ToolInputError(
      failure(
        `it is neither a Structural Ref nor a selector this runtime supports: ${diagnosis}`,
        hint
      )
    );
  }
  if (refs.length === 0)
    throw new RefResolutionError(
      failure("the selector matches no element", hint)
    );
  if (refs.length > 1)
    throw new RefResolutionError(
      failure(
        `the selector matches ${refs.length} elements; it must match exactly one`
      )
    );
  return { elementRef: refs[0]!, selector };
}

// --- Registration ---

/**
 * Package-internal: register a Custom Tool. It takes a Structural Ref as
 * `ref`, acts on its element through a Locator on the Run's page, and the
 * Goal Loop may offer it the elements its filter keeps, or every node with a
 * ref when it has no filter.
 */
export function registerCustomTool(
  customTool: CustomTool
): RegisteredElementTool {
  return registerElementTool(
    {
      name: customTool.name,
      description: customTool.description,
      label: `run "${customTool.name}" on`,
      inputSchema: REF_INPUT_SCHEMA,
      targetField: "ref",
      perform: ({ ref }, _input, { run, page }) =>
        customTool.execute(
          { ref: ref!, locator: page.locator(selectorForRef(ref!)) },
          {
            run: ((name, input) =>
              run(name, input)) as CustomToolContext["run"],
          }
        ),
    },
    customTool.filter ? { filter: customTool.name } : { every: true }
  );
}

/** The nodes a tool takes and the subset its input would reach. */
export type ElementToolTargets = {
  /** Every node of the capture, in tree order, the tool takes before reach. */
  readonly matched: readonly StructuralNode[];
  /** Those of them its input would reach: the tool's closed set. */
  readonly nodes: readonly StructuralNode[];
};

/**
 * The closed set a single-element tool's ref comes from (ADR-0023): every
 * node of the capture, in tree order, the tool takes, measured for reach in
 * one batch in the page when the tool needs it. The Goal Loop offers these as
 * options; the Inspector shows them as the tool's targets. A predicate's
 * nodes come from the refs the capture carries for it.
 */
export async function elementToolTargets(
  tool: Pick<RegisteredElementTool, "takes" | "needsReach">,
  { page, reach }: ReachOn,
  capture: PageStateCapture
): Promise<ElementToolTargets> {
  const matched = [...walkNodes(capture.tree)].filter(
    takenBy(tool.takes, capture)
  );
  if (!tool.needsReach) return { matched, nodes: matched };
  const reached = new Set(
    await reach.reachable(
      page,
      matched.map(({ ref }) => ref),
      tool.needsReach
    )
  );
  return { matched, nodes: matched.filter(({ ref }) => reached.has(ref)) };
}

function takenBy(
  takes: ElementTake,
  capture: PageStateCapture
): (node: StructuralNode) => boolean {
  if ("every" in takes) return () => true;
  const name =
    "filter" in takes ? toolFilterKey(takes.filter) : takes.predicate;
  const accepted = capture.accepted?.[name];
  if (!accepted)
    throw new RuntimeStateError(`The capture carries no refs for ${name}.`);
  return ({ ref }) => accepted.has(ref);
}

function* walkNodes(tree: StructuralTree): Generator<StructuralNode> {
  const pending = [...tree.getRootNodes()].reverse();
  while (pending.length > 0) {
    const node = pending.pop()!;
    yield node;
    for (let index = node.children.length - 1; index >= 0; index--) {
      const child = node.children[index]!;
      if (typeof child !== "string") pending.push(child);
    }
  }
}
