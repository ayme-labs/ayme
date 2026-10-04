// Browser Tools: the built-in operations on the page itself, mirroring
// Playwright MCP's tools at the revision the README pins. Field names and
// defaults follow Playwright MCP, without its permission-prompt `element`;
// descriptions are Ayme's own.
import type { JsonSchema } from "./contracts";
import { runAction } from "./actionSequence";
import {
  listCustomTools,
  locatorOf,
  registerElementTool,
  requireCurrentDocument,
  resolveElementTarget,
  validatedToolInput,
  type PublishedElementTool,
  type ElementToolDefinition,
  type RegisteredElementTool,
  type ResolvedTarget,
} from "./elementTools";
import { generateLocatorTool } from "./generateLocator";
import { requireAymeRuntimePage } from "./registry";

// --- Input schemas ---

const TARGET: JsonSchema = {
  type: "string",
  description:
    "A Structural Ref from the page snapshot, or a selector that matches exactly one element.",
};

const BUTTON: JsonSchema = {
  type: "string",
  enum: ["left", "right", "middle"],
  description: "Button to click; left when omitted.",
};

const MODIFIERS: JsonSchema = {
  type: "array",
  items: {
    type: "string",
    enum: ["Alt", "Control", "ControlOrMeta", "Meta", "Shift"],
  },
  description: "Modifier keys to hold during the click.",
};

/** An object schema with a required `target`. */
function elementInput(
  properties: Record<string, JsonSchema> = {},
  required: readonly string[] = []
): JsonSchema {
  return {
    type: "object",
    properties: { target: TARGET, ...properties },
    required: ["target", ...required],
    additionalProperties: false,
  };
}

// --- Single-element Browser Tools ---

type Fields = Record<string, unknown>;

/** Click options as Playwright takes them, from the input given. */
function clickOptions(input: Fields) {
  return {
    ...(input.button !== undefined
      ? { button: input.button as "left" | "right" | "middle" }
      : {}),
    ...(input.modifiers !== undefined
      ? {
          modifiers: input.modifiers as (
            "Alt" | "Control" | "ControlOrMeta" | "Meta" | "Shift"
          )[],
        }
      : {}),
  };
}

function browserTool(
  name: string,
  description: string,
  inputSchema: JsonSchema,
  run: (target: ResolvedTarget, input: Fields) => Promise<unknown>
): ElementToolDefinition {
  return {
    name,
    description,
    label: name,
    inputSchema,
    targetField: "target",
    // An action's own result would appear under `result`; Browser Tools have
    // none, as in Playwright MCP, so `selectOption`'s values are dropped.
    run: async (target, input) => {
      await run(target, input);
    },
  };
}

const clickDefinition = browserTool(
  "click",
  "Click one element.",
  elementInput({
    doubleClick: {
      type: "boolean",
      description: "Double-click instead; false when omitted.",
    },
    button: BUTTON,
    modifiers: MODIFIERS,
  }),
  async (target, input) => {
    const locator = await locatorOf(target);
    if (input.doubleClick === true) await locator.dblclick(clickOptions(input));
    else await locator.click(clickOptions(input));
  }
);

const hoverDefinition = browserTool(
  "hover",
  "Move the pointer over one element.",
  elementInput(),
  async (target) => (await locatorOf(target)).hover()
);

const typeDefinition = browserTool(
  "type",
  "Type text into one editable element. Replaces its value, unless typing slowly, which types one character at a time.",
  elementInput(
    {
      text: { type: "string", description: "Text to type." },
      submit: {
        type: "boolean",
        description: "Press Enter after the text; false when omitted.",
      },
      slowly: {
        type: "boolean",
        description:
          "Type one character at a time, for key handlers in the page; false when omitted.",
      },
    },
    ["text"]
  ),
  async (target, input) => {
    const locator = await locatorOf(target);
    const text = input.text as string;
    if (input.slowly === true) await locator.pressSequentially(text);
    else await locator.fill(text);
    if (input.submit === true) await locator.press("Enter");
  }
);

const fillDefinition = browserTool(
  "fill",
  "Replace the value of one editable element with text.",
  elementInput({ text: { type: "string", description: "Text to fill." } }, [
    "text",
  ]),
  async (target, input) => (await locatorOf(target)).fill(input.text as string)
);

const checkDefinition = browserTool(
  "check",
  "Check one checkbox or radio button.",
  elementInput(),
  async (target) => (await locatorOf(target)).check()
);

const uncheckDefinition = browserTool(
  "uncheck",
  "Uncheck one checkbox.",
  elementInput(),
  async (target) => (await locatorOf(target)).uncheck()
);

const selectOptionDefinition = browserTool(
  "select_option",
  "Select one or more options of one select element, by value or label.",
  elementInput(
    {
      values: {
        type: "array",
        items: { type: "string" },
        description: "Values or labels of the options to select.",
      },
    },
    ["values"]
  ),
  async (target, input) =>
    (await locatorOf(target)).selectOption(input.values as string[])
);

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
  "[contenteditable='plaintext-only']",
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

/** The filter of click and hover: not disabled, interactive or pointer-cursored. */
export function isClickableElement(element: Element): boolean {
  if (isDisabled(element)) return false;
  return (
    element.matches(INTERACTIVE_ROLE_SELECTOR) ||
    element.ownerDocument.defaultView?.getComputedStyle(element).cursor ===
      "pointer"
  );
}

/** The filter of type and fill: an element text can actually be entered into. */
export function isFillableElement(element: Element): boolean {
  if (isDisabled(element)) return false;
  if (
    element.matches(
      "[contenteditable=''], [contenteditable='true'], [contenteditable='plaintext-only']"
    )
  )
    return true;
  if (element instanceof HTMLTextAreaElement) return !element.readOnly;
  if (element instanceof HTMLInputElement)
    return !element.readOnly && FILLABLE_INPUT_TYPES.has(element.type);
  return false;
}

const UNCHECKABLE_SELECTOR =
  "input[type=checkbox], [role=checkbox], [role=menuitemcheckbox], [role=switch]";

/** The filter of check: a checkbox, radio button or switch that is not disabled. */
export function isCheckableElement(element: Element): boolean {
  if (isDisabled(element)) return false;
  return element.matches(
    `${UNCHECKABLE_SELECTOR}, input[type=radio], [role=radio], [role=menuitemradio]`
  );
}

/** The filter of uncheck: a checkbox or switch; a radio button cannot be unchecked. */
export function isUncheckableElement(element: Element): boolean {
  return !isDisabled(element) && element.matches(UNCHECKABLE_SELECTOR);
}

/** The filter of select_option: a select element that is not disabled. */
export function isSelectElement(element: Element): boolean {
  return element instanceof HTMLSelectElement && !isDisabled(element);
}

const SINGLE_ELEMENT_TOOLS: readonly RegisteredElementTool[] = [
  registerElementTool(clickDefinition, isClickableElement),
  registerElementTool(hoverDefinition, isClickableElement),
  registerElementTool(typeDefinition, isFillableElement),
  registerElementTool(fillDefinition, isFillableElement),
  registerElementTool(checkDefinition, isCheckableElement),
  registerElementTool(uncheckDefinition, isUncheckableElement),
  registerElementTool(selectOptionDefinition, isSelectElement),
];

/**
 * Package-internal: the single-element Browser Tools and the session's Custom
 * Tools, in publication order. Each is published and the Goal Loop may choose
 * it (ADR-0023).
 */
export function listElementTools(): readonly RegisteredElementTool[] {
  return [...SINGLE_ELEMENT_TOOLS, ...listCustomTools()];
}

// --- Browser Tools that are published only ---

const FILL_FORM_FIELD_TYPES = [
  "textbox",
  "checkbox",
  "radio",
  "combobox",
  "slider",
] as const;

const fillFormSchema: JsonSchema = {
  type: "object",
  properties: {
    fields: {
      type: "array",
      description: "Fields to fill, in order.",
      items: elementInput(
        {
          name: { type: "string", description: "Human-readable field name." },
          type: {
            type: "string",
            enum: FILL_FORM_FIELD_TYPES,
            description: "Type of the field.",
          },
          value: {
            type: "string",
            description:
              "Value to fill in. For a checkbox or radio, `true` or `false`; for a combobox, the label of the option.",
          },
        },
        ["name", "type", "value"]
      ),
    },
  },
  required: ["fields"],
  additionalProperties: false,
};

type FormField = {
  target: string;
  name: string;
  type: (typeof FILL_FORM_FIELD_TYPES)[number];
  value: string;
};

async function fillField(field: FormField, currentDocument: Document) {
  const locator = await locatorOf(
    await resolveElementTarget(
      { label: `fill the field "${field.name}" at`, targetField: "target" },
      field.target,
      currentDocument
    )
  );
  switch (field.type) {
    case "textbox":
    case "slider":
      return locator.fill(field.value);
    case "checkbox":
    case "radio":
      return locator.setChecked(field.value === "true");
    case "combobox":
      return locator.selectOption({ label: field.value });
  }
}

/**
 * Fill the fields in order and stop at the first failure. The result names the
 * fields filled and the one that failed; filled fields stay filled.
 */
const fillFormTool: PublishedElementTool = {
  name: "fill_form",
  description:
    "Fill several form fields in one call, in order. Stops at the first field that fails; the fields filled before it stay filled.",
  inputSchema: fillFormSchema,
  execute: (input: unknown) => fillFormTool.executeAs(input, "agent"),
  executeAs: async (input, caller) => {
    const fields = validatedToolInput(fillFormSchema, input)
      .fields as FormField[];
    const currentDocument = requireCurrentDocument();
    return runAction(
      currentDocument,
      caller,
      { tool: "fill_form", args: input },
      async () => {
        const filled: string[] = [];
        for (const field of fields) {
          try {
            await fillField(field, currentDocument);
          } catch (error) {
            return {
              filled,
              failed: {
                name: field.name,
                error: error instanceof Error ? error.message : String(error),
              },
            };
          }
          filled.push(field.name);
        }
        return { filled };
      }
    );
  },
};

const pressKeySchema: JsonSchema = {
  type: "object",
  properties: {
    key: {
      type: "string",
      description:
        "Name of the key to press or a character to generate, such as `ArrowLeft`, `a` or `ControlOrMeta+A`.",
    },
  },
  required: ["key"],
  additionalProperties: false,
};

/** Press a key on the focused element. */
const pressKeyTool: PublishedElementTool = {
  name: "press_key",
  description: "Press a key on the element that has focus.",
  inputSchema: pressKeySchema,
  execute: (input: unknown) => pressKeyTool.executeAs(input, "agent"),
  executeAs: async (input, caller) => {
    const { key } = validatedToolInput(pressKeySchema, input) as {
      key: string;
    };
    return runAction(
      requireCurrentDocument(),
      caller,
      { tool: "press_key", args: input },
      () => requireAymeRuntimePage().keyboard.press(key)
    );
  },
};

/** Browser Tools that take no single element, published only. */
const PUBLISHED_ONLY_BROWSER_TOOLS: readonly PublishedElementTool[] = [
  fillFormTool,
  pressKeyTool,
  generateLocatorTool,
];

/** Package-internal: every Browser Tool as published, in publication order. */
export function listPublishedBrowserTools(): readonly PublishedElementTool[] {
  return [
    ...SINGLE_ELEMENT_TOOLS.map(({ tool }) => tool),
    ...PUBLISHED_ONLY_BROWSER_TOOLS,
  ];
}
