import {
  AriaRefSchema,
  type StructuralNode,
  type StructuralTree,
} from "@ayme-dev/core/structural-observation";
import { runAction } from "./actionSequence";
import type { JsonSchema, JsonValue, ToolDescriptor } from "./contracts";
import type { RunContext } from "./run";
import type { ToolInput, ToolResult } from "./toolTypes";
import {
  resolvePageStateRefs,
  type AriaRef,
  type AymeNode,
  type PageStateCapture,
} from "./pageState";
import { resolveLocatorElements } from "@ayme-dev/playwright-lite/internal";
import { requireAymeRuntimePage } from "./registry";
import { throwFirstViolation, toolInputViolations } from "./schemaValidation";
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
  /** true = the Goal Loop may offer this element; not enforced on direct calls. */
  readonly filter: (element: Element) => boolean;
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
  /** A selector for it, for the browser Page: `aria-ref=…` or the one given. */
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
 * How a tool that acts on one element executes for a Run: check the input
 * against the schema, resolve the element (a ref through the identity
 * ledger, ADR-0028) and hand `perform` the element. Finishes with the
 * shared action sequence, so every such tool returns the same action result.
 */
function elementToolExecution(
  definition: ElementToolDefinition
): PublishedElementTool["execute"] {
  return async (input, context) => {
    const fields = validatedToolInput(definition.inputSchema, input);
    const currentDocument = requireCurrentDocument();
    const target = await resolveElementTarget(
      definition,
      fields[definition.targetField] as string,
      currentDocument
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
    filter,
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
 * Package-internal: check a tool's input against its object schema. An
 * option the schema does not declare is rejected by name, never ignored.
 */
export function validatedToolInput(
  schema: JsonSchema,
  input: unknown
): Record<string, unknown> {
  throwFirstViolation(toolInputViolations(schema, input));
  return input as Record<string, unknown>;
}

/**
 * A Structural Ref rather than a selector: Playwright MCP's ref pattern
 * (`e12`), plus Ayme's synthetic `s_` refs, which resolution then rejects.
 */
const STRUCTURAL_REF = /^(e\d+|s_.+)$/;

/**
 * Package-internal: resolve the element one call addresses. A `ref` is a
 * Structural Ref; a `target` is a Structural Ref or a selector, which must
 * match exactly one element.
 */
export async function resolveElementTarget(
  definition: Pick<ElementToolDefinition, "label" | "targetField">,
  requested: string,
  currentDocument: Document
): Promise<ResolvedTarget> {
  if (definition.targetField === "ref" || STRUCTURAL_REF.test(requested)) {
    const node = await resolveTarget(
      definition.label,
      AriaRefSchema.parse(requested),
      currentDocument
    );
    return {
      ref: node.ref,
      element: node.element,
      selector: `aria-ref=${node.ref}`,
    };
  }
  const fail = (reason: string) =>
    new RefResolutionError(
      `Cannot ${definition.label} "${requested}": ${reason}.`
    );
  // generate_locator returns locator expressions for Page Object code; an
  // agent that passes one back as a target needs to hear what to pass instead.
  if (/^\s*(page\.)?(getBy\w+|locator)\(/.test(requested))
    throw new ToolInputError(
      `The target "${requested}" is a Playwright locator expression, which tools do not take. Pass a Structural Ref from snapshot, or a selector such as role=button[name="Save"] or text=Save.`
    );
  const page = requireAymeRuntimePage();
  let elements: Element[];
  try {
    elements = resolveLocatorElements(page.locator(requested));
  } catch (error) {
    throw new ToolInputError(
      `The target "${requested}" is neither a Structural Ref nor a selector this runtime supports: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
  if (elements.length === 0) throw fail("the selector matches no element");
  if (elements.length > 1)
    throw fail(
      `the selector matches ${elements.length} elements; it must match exactly one`
    );
  return { element: elements[0]!, selector: requested };
}

/** Resolve a requested ref to the node it addresses now, or fail clearly. */
async function resolveTarget(
  label: string,
  requestedRef: AriaRef,
  currentDocument: Document
): Promise<AymeNode> {
  const fail = (reason: string) =>
    new RefResolutionError(`Cannot ${label} ref "${requestedRef}": ${reason}.`);

  if (requestedRef.startsWith("s_"))
    throw fail("synthetic observation-only ref");

  const resolution = (
    await resolvePageStateRefs(currentDocument, requestedRef)
  )[0]!;
  if (resolution.status === "unresolved") throw fail(resolution.reason);
  if (resolution.node.ref.startsWith("s_"))
    throw fail("synthetic observation-only ref");
  return resolution.node;
}

/** Package-internal: the browser Page's locator for a resolved element. */
export async function locatorOf(target: ResolvedTarget) {
  const page = requireAymeRuntimePage();
  // Page.ariaSnapshot updates Playwright-lite's public aria-ref lookup. The
  // action must use the ref returned by the current Page State resolution.
  if (target.ref) await page.ariaSnapshot({ mode: "ai" });
  return page.locator(target.selector);
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
  const nodes: StructuralNode[] = [];
  for (const node of walkNodes(capture.tree)) {
    // Synthetic refs are observation-only: a single-element tool rejects them.
    if (node.ref.startsWith("s_")) continue;
    const element = capture.elementsByRef.get(node.ref);
    if (!element || !filter(element)) continue;
    nodes.push(node);
  }
  return nodes;
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
