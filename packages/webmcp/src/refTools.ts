import { AriaRefSchema } from "@ayme-dev/core/structural-observation";
import type { ModelContextTool } from "@mcp-b/webmcp-types";
import { runAction, type ActionResult } from "./actionSequence";
import type { JsonSchema, JsonValue } from "./contracts";
import type { Caller } from "./interactionHistory";
import { resolvePageStateRefs, type AriaRef, type AymeNode } from "./pageState";
import { requireAymeRuntimePage } from "./registry";
import {
  RefResolutionError,
  RuntimeStateError,
  ToolInputError,
} from "./errors";

/**
 * An operation that applies to one Structural Ref. One registration publishes
 * it as a WebMCP Tool for the calling agent and makes it an operation the Goal
 * Loop may choose (ADR-0023).
 */
export type RefTool = {
  name: string;
  /** The only instruction the model gets about this operation. */
  description: string;
  /** true = the Goal Loop may offer this element. Omitted = every node with a ref. */
  filter?: (element: Element) => boolean;
  execute(target: { ref: AriaRef; element: Element }): Promise<unknown>;
};

/** A Ref Tool as published: input `{ ref }` plus whatever else it declares. */
export type PublishedRefTool = ModelContextTool<
  Record<string, unknown>,
  JsonValue
> & {
  inputSchema: JsonSchema;
  execute(input: unknown): Promise<JsonValue>;
};

/** Runs a Ref Tool for the caller it is given. */
type CallerRun = (input: unknown, caller: Caller) => Promise<ActionResult>;

/** Package-internal: a Ref Tool ready to publish, with the filter it offers. */
export type RegisteredRefTool = {
  /** As published, its `execute` runs it as the calling agent. */
  readonly tool: PublishedRefTool;
  /** true = the Goal Loop may offer this element; not enforced on direct calls. */
  readonly filter: (element: Element) => boolean;
  /** Runs it as the caller given; the Goal Loop runs it as its model. */
  readonly executeAs: CallerRun;
};

/** What a Ref Tool does once its ref is resolved. */
type RefToolDefinition = {
  name: string;
  description: string;
  /** Names the operation in a resolution error: `Cannot ${label} ref "e1": …`. */
  label: string;
  inputSchema: JsonSchema;
  run(target: AymeNode, input: Record<string, unknown>): Promise<unknown>;
};

const REF_INPUT_SCHEMA: JsonSchema = {
  type: "object",
  properties: { ref: { type: "string" } },
  required: ["ref"],
  additionalProperties: false,
};

// --- The shared mechanism ---

/**
 * Publish a Ref Tool: parse the incoming ref at the tool-input boundary,
 * resolve it against the Page State Session (ADR-0012) and hand `execute` the
 * current ref and its element. Finishes with the shared action sequence, so
 * every Ref Tool returns the same action result.
 */
function publishRefTool(definition: RefToolDefinition): PublishedRefTool {
  const executeAs = refToolRun(definition);
  return {
    name: definition.name,
    description: definition.description,
    inputSchema: definition.inputSchema,
    execute: (input: unknown) => executeAs(input, "agent"),
  };
}

function refToolRun(definition: RefToolDefinition): CallerRun {
  return async (input, caller) => {
    const fields = readInputFields(input);
    return runRefTool(
      definition,
      AriaRefSchema.parse(fields.ref),
      fields,
      caller
    );
  };
}

function registerRefTool(
  definition: RefToolDefinition,
  filter: (element: Element) => boolean,
  tool: PublishedRefTool = publishRefTool(definition)
): RegisteredRefTool {
  return { tool, filter, executeAs: refToolRun(definition) };
}

async function runRefTool(
  definition: RefToolDefinition,
  requestedRef: AriaRef,
  input: Record<string, unknown>,
  caller: Caller,
  currentDocument: Document = requireCurrentDocument()
): Promise<ActionResult> {
  const target = await resolveTarget(
    definition.label,
    requestedRef,
    currentDocument
  );
  return runAction(
    currentDocument,
    caller,
    { tool: definition.name, args: input, targetRef: target.ref },
    () => definition.run(target, input)
  );
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

function readInputFields(input: unknown): Record<string, unknown> & {
  ref: string;
} {
  if (
    typeof input === "object" &&
    input !== null &&
    "ref" in input &&
    typeof input.ref === "string"
  )
    return input as Record<string, unknown> & { ref: string };
  throw new ToolInputError("A Structural Ref string is required.");
}

function requireCurrentDocument(): Document {
  if (typeof document === "undefined")
    throw new RuntimeStateError(
      "Structural Ref interactions require a browser Document."
    );
  return document;
}

// --- Built-in Ref Tools ---

const clickDefinition: RefToolDefinition = {
  name: "click_page_state_ref",
  description:
    "Click a real element ref from get_page_context. The ref is resolved against a fresh capture before the action.",
  label: "click",
  inputSchema: REF_INPUT_SCHEMA,
  run: async ({ ref }) => {
    // Page.ariaSnapshot updates Playwright-lite's public aria-ref lookup. The
    // action must use the ref returned by the current Page State resolution.
    const page = requireAymeRuntimePage();
    await page.ariaSnapshot({ mode: "ai" });
    await page.click(`aria-ref=${ref}`);
  },
};

const fillDefinition: RefToolDefinition = {
  name: "fill_page_state_ref",
  description:
    "Fill a real editable element ref from get_page_context with text. The ref is resolved against a fresh capture before the action.",
  label: "fill",
  inputSchema: {
    type: "object",
    properties: { ref: { type: "string" }, value: { type: "string" } },
    required: ["ref", "value"],
    additionalProperties: false,
  },
  run: async ({ ref }, input) => {
    const { value } = input;
    if (typeof value !== "string")
      throw new ToolInputError(
        "A Structural Ref and string value are required."
      );
    const page = requireAymeRuntimePage();
    await page.ariaSnapshot({ mode: "ai" });
    await page.fill(`aria-ref=${ref}`, value);
  },
};

export const clickPageStateRefTool = publishRefTool(clickDefinition);
export const fillPageStateRefTool = publishRefTool(fillDefinition);

/** Click a Structural Ref that is already parsed, for `ayme.click`. */
export function clickRef(ref: AriaRef): Promise<ActionResult> {
  return runRefTool(clickDefinition, ref, {}, "agent");
}

/** Fill a Structural Ref that is already parsed, for `ayme.fill`. */
export function fillRef(ref: AriaRef, value: string): Promise<ActionResult> {
  return runRefTool(fillDefinition, ref, { value }, "agent");
}

// --- Built-in filters ---

const INTERACTIVE_ROLE_SELECTOR = [
  "a[href]",
  "button",
  "input",
  "select",
  "summary",
  "textarea",
  "[contenteditable='']",
  "[contenteditable='true']",
  "[role=button]",
  "[role=checkbox]",
  "[role=combobox]",
  "[role=link]",
  "[role=menuitem]",
  "[role=menuitemcheckbox]",
  "[role=menuitemradio]",
  "[role=option]",
  "[role=radio]",
  "[role=searchbox]",
  "[role=slider]",
  "[role=spinbutton]",
  "[role=switch]",
  "[role=tab]",
  "[role=textbox]",
].join(",");

/** Playwright fills these input types; any other type cannot be filled. */
const FILLABLE_INPUT_TYPES = new Set([
  "color",
  "date",
  "datetime-local",
  "email",
  "month",
  "number",
  "password",
  "range",
  "search",
  "tel",
  "text",
  "time",
  "url",
  "week",
]);

function isDisabled(element: Element): boolean {
  return element.matches(":disabled, [aria-disabled='true']");
}

/** The built-in filter of click: not disabled, interactive or pointer-cursored. */
export function isClickableElement(element: Element): boolean {
  if (isDisabled(element)) return false;
  return (
    element.matches(INTERACTIVE_ROLE_SELECTOR) ||
    element.ownerDocument.defaultView?.getComputedStyle(element).cursor ===
      "pointer"
  );
}

/** The built-in filter of fill: an element text can actually be entered into. */
export function isFillableElement(element: Element): boolean {
  if (isDisabled(element)) return false;
  if (element.matches("[contenteditable=''], [contenteditable='true']"))
    return true;
  if (element instanceof HTMLTextAreaElement) return !element.readOnly;
  if (element instanceof HTMLInputElement)
    return !element.readOnly && FILLABLE_INPUT_TYPES.has(element.type);
  return false;
}

// --- Registration ---

type RefToolStore = { registered?: readonly RegisteredRefTool[] };

const refToolStore: RefToolStore = ((
  globalThis as typeof globalThis & { __aymeRefToolStore?: RefToolStore }
).__aymeRefToolStore ??= {});

/** Package-internal: set while a runtime session is active. */
export function configureRefTools(
  refTools: readonly RefTool[] | undefined
): void {
  refToolStore.registered = refTools?.map((refTool) =>
    registerRefTool(
      {
        name: refTool.name,
        description: refTool.description,
        label: `run "${refTool.name}" on`,
        inputSchema: REF_INPUT_SCHEMA,
        run: (target) => refTool.execute(target),
      },
      refTool.filter ?? (() => true)
    )
  );
}

const BUILT_IN_REF_TOOLS: readonly RegisteredRefTool[] = [
  registerRefTool(clickDefinition, isClickableElement, clickPageStateRefTool),
  registerRefTool(fillDefinition, isFillableElement, fillPageStateRefTool),
];

/** Package-internal: the built-in and registered Ref Tools, in publication order. */
export function listRefTools(): readonly RegisteredRefTool[] {
  return [...BUILT_IN_REF_TOOLS, ...(refToolStore.registered ?? [])];
}
