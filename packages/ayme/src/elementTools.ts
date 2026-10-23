import {
  parseStructuralRef,
  selectorForRef,
  type StructuralNode,
  type StructuralTree,
} from "@ayme-dev/core/structural-observation";
import { runAction } from "./actionSequence";
import type { JsonSchema, JsonValue, ToolDescriptor } from "./contracts";
import type { RunContext } from "./run";
import type { ToolInput, ToolResult } from "./toolTypes";
import type { AriaRef, PageStateCapture } from "./pageState";
import { refHint, resolveRef, selectorFailure } from "./refTarget";
import { resolveLocatorElements } from "@ayme-dev/playwright-lite/internal";
import { requireAymeRuntimePage } from "./registry";
import { assertReachable, reaches, type ElementInput } from "./elementReach";
import { inReachBatch } from "./reachMeasurement";
import {
  RefResolutionError,
  RuntimeStateError,
  ToolInputError,
} from "./errors";

/**
 * A Custom Tool: an operation an app registers that applies to one element.
 * One registration publishes it as a WebMCP Tool for the calling agent and
 * makes it an operation the Goal Loop may choose (ADR-0023).
 */
export type CustomTool = {
  name: string;
  /** The only instruction the model gets about this operation. */
  description: string;
  /** true = the Goal Loop may offer this element. Omitted = every node with a ref. */
  filter?: (element: Element) => boolean;
  /**
   * Acts on `target`. To use other tools, start them through `run`: each is
   * a child Run of this one and runs within this Run's turn, after the
   * child Runs started before it. Never call `ayme.tools.run` from here:
   * that Run waits for this one to end, so neither ever finishes.
   */
  execute(
    target: { ref: AriaRef; element: Element },
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
 * whose context carries the cursor its Change Record reads from and moves.
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
   * true = the Goal Loop may offer this element; not enforced on direct
   * calls. For a tool that needs reach, it keeps only elements a click would
   * reach, which a direct call does enforce.
   */
  readonly filter: (element: Element) => boolean;
  /**
   * For a tool that needs reach, its filter before reach: what it may act on
   * whether or not a click would reach it.
   */
  readonly matches?: (element: Element) => boolean;
};

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
  element: Element;
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
    const currentDocument = requireCurrentDocument();
    const target = await resolveElementTarget(
      definition,
      fields[definition.targetField] as string,
      currentDocument
    );
    if (definition.needsReach)
      await assertReachable(
        definition.name,
        locatorOf(target),
        target.element,
        definition.needsReach
      );
    return runAction(
      currentDocument,
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
  filter: (element: Element) => boolean
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
    // The cheap filter first: only the elements it keeps are measured.
    ...(definition.needsReach
      ? {
          filter: (element: Element) =>
            filter(element) &&
            reaches(requireAymeRuntimePage(), element, definition.needsReach!),
          matches: filter,
        }
      : { filter }),
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
 * a Structural Ref, else a selector, which must match exactly one element.
 * With `scope`, a selector is matched inside the element that selector
 * addresses, and the selector returned is relative to it; a Structural Ref
 * names its element wherever it is.
 */
export async function resolveElementTarget(
  definition: Pick<ElementToolDefinition, "label" | "targetField">,
  requested: string,
  currentDocument: Document,
  scope?: string
): Promise<ResolvedTarget> {
  if (definition.targetField === "ref" || parseStructuralRef(requested)) {
    const node = await resolveRef(requested, definition.label, currentDocument);
    return {
      ref: node.ref,
      element: node.element,
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
  const page = requireAymeRuntimePage();
  let elements: Element[];
  try {
    elements = resolveLocatorElements(
      scope === undefined
        ? page.locator(requested)
        : page.locator(scope).locator(requested)
    );
  } catch (error) {
    throw new ToolInputError(
      failure(
        `it is neither a Structural Ref nor a selector this runtime supports: ${
          error instanceof Error ? error.message : String(error)
        }`,
        hint
      )
    );
  }
  if (elements.length === 0)
    throw new RefResolutionError(
      failure("the selector matches no element", hint)
    );
  if (elements.length > 1)
    throw new RefResolutionError(
      failure(
        `the selector matches ${elements.length} elements; it must match exactly one`
      )
    );
  return { element: elements[0]!, selector: requested };
}

/** Package-internal: the browser Page's locator for a resolved element. */
export function locatorOf(target: ResolvedTarget) {
  return requireAymeRuntimePage().locator(target.selector);
}

export function requireCurrentDocument(): Document {
  if (typeof document === "undefined")
    throw new RuntimeStateError(
      "Structural Ref interactions require a browser Document."
    );
  return document;
}

// --- Registration ---

type CustomToolStore = { registered?: readonly RegisteredElementTool[] };

const customToolStore: CustomToolStore = ((
  globalThis as typeof globalThis & { __aymeCustomToolStore?: CustomToolStore }
).__aymeCustomToolStore ??= {});

/** Package-internal: set while a runtime session is active. */
export function configureCustomTools(
  customTools: readonly CustomTool[] | undefined
): void {
  customToolStore.registered = customTools?.map((customTool) =>
    registerElementTool(
      {
        name: customTool.name,
        description: customTool.description,
        label: `run "${customTool.name}" on`,
        inputSchema: REF_INPUT_SCHEMA,
        targetField: "ref",
        perform: ({ ref, element }, _input, { run }) =>
          customTool.execute(
            { ref: ref!, element },
            {
              run: ((name, input) =>
                run(name, input)) as CustomToolContext["run"],
            }
          ),
      },
      customTool.filter ?? (() => true)
    )
  );
}

/** Package-internal: the Custom Tools of the active session, in registration order. */
export function listCustomTools(): readonly RegisteredElementTool[] {
  return customToolStore.registered ?? [];
}

/**
 * The closed set a single-element tool's ref comes from (ADR-0023): every node of the
 * capture, in tree order, whose element the tool's filter keeps. The Goal Loop
 * offers these as options; the Inspector shows them as the tool's targets.
 */
export function acceptedRefNodes(
  filter: (element: Element) => boolean,
  capture: PageStateCapture
): StructuralNode[] {
  return inReachBatch(() => {
    const nodes: StructuralNode[] = [];
    for (const node of walkNodes(capture.tree)) {
      const element = capture.elementsByRef.get(node.ref);
      if (!element || !filter(element)) continue;
      nodes.push(node);
    }
    return nodes;
  });
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
