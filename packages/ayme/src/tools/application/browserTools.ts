// Browser Tools: the built-in operations on the page itself, mirroring
// Playwright MCP's tools at the revision the README pins. Field names and
// defaults follow Playwright MCP, without its permission-prompt `element`;
// descriptions are Ayme's own.
import type { Locator, Page } from "@playwright/test";
import type { JsonSchema } from "../../shared";
import {
  assertReachable,
  runAction,
  type ElementInput,
} from "../../page-state";
import {
  listCustomTools,
  locatorOf,
  registerElementTool,
  requireCurrentDocument,
  resolveElementTarget,
  TARGET_SCHEMA,
  type PublishedElementTool,
  type ElementToolDefinition,
  type RegisteredElementTool,
} from "./elementTools";
import {
  isCheckableElement,
  isClickableElement,
  isFillableElement,
  isSelectElement,
  isUncheckableElement,
} from "../domain/elementFilters";
import {
  navigateBackTool,
  navigateForwardTool,
  reloadTool,
} from "./historyTools";
import { navigateTool } from "./navigateTool";

// --- Input schemas ---

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
    properties: { target: TARGET_SCHEMA, ...properties },
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

/** A single-element Browser Tool; `perform` acts on the element's locator. */
function browserTool(
  name: string,
  description: string,
  inputSchema: JsonSchema,
  needsReach: ElementInput,
  perform: (locator: Locator, input: Fields) => Promise<unknown>
): ElementToolDefinition {
  return {
    name,
    description,
    label: name,
    inputSchema,
    targetField: "target",
    needsReach,
    // An action's own result would appear under `result`; Browser Tools have
    // none, as in Playwright MCP, so `selectOption`'s values are dropped.
    perform: async (target, input, { page }) => {
      await perform(locatorOf(page, target), input);
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
  "click",
  async (locator, input) => {
    if (input.doubleClick === true) await locator.dblclick(clickOptions(input));
    else await locator.click(clickOptions(input));
  }
);

const hoverDefinition = browserTool(
  "hover",
  "Move the pointer over one element.",
  elementInput(),
  "click",
  async (locator) => locator.hover()
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
  "focus",
  async (locator, input) => {
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
  "focus",
  async (locator, input) => locator.fill(input.text as string)
);

const checkDefinition = browserTool(
  "check",
  "Check one checkbox or radio button.",
  elementInput(),
  "click",
  async (locator) => locator.check()
);

const uncheckDefinition = browserTool(
  "uncheck",
  "Uncheck one checkbox.",
  elementInput(),
  "click",
  async (locator) => locator.uncheck()
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
  "focus",
  async (locator, input) => locator.selectOption(input.values as string[])
);

/** Package-internal: the single-element Browser Tools, in publication order. */
export const SINGLE_ELEMENT_TOOLS: readonly RegisteredElementTool[] = [
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

async function fillField(
  page: Page,
  field: FormField,
  currentDocument: Document
) {
  const target = await resolveElementTarget(
    page,
    { label: `fill the field "${field.name}" at`, targetField: "target" },
    field.target,
    currentDocument
  );
  const locator = locatorOf(page, target);
  await assertReachable(
    "fill_form",
    locator,
    target.element,
    field.type === "checkbox" || field.type === "radio" ? "click" : "focus"
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
 * Package-internal: fill the fields in order and stop at the first failure.
 * The result names the fields filled and the one that failed; filled fields
 * stay filled.
 */
export const fillFormTool: PublishedElementTool = {
  name: "fill_form",
  description:
    "Fill several form fields in one call, in order. Stops at the first field that fails; the fields filled before it stay filled.",
  inputSchema: fillFormSchema,
  execute: async (input, context) => {
    const { cursor, page } = context;
    const { fields } = input as { fields: FormField[] };
    const currentDocument = requireCurrentDocument();
    return runAction(
      currentDocument,
      cursor,
      { tool: "fill_form", args: input },
      async () => {
        const filled: string[] = [];
        for (const field of fields) {
          try {
            await fillField(page, field, currentDocument);
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

/** Package-internal: press a key on the focused element. */
export const pressKeyTool: PublishedElementTool = {
  name: "press_key",
  description: "Press a key on the element that has focus.",
  inputSchema: pressKeySchema,
  execute: async (input, context) => {
    const { cursor, page } = context;
    const { key } = input as { key: string };
    return runAction(
      requireCurrentDocument(),
      cursor,
      { tool: "press_key", args: input },
      () => page.keyboard.press(key)
    );
  },
};

// --- Browser Tools that move the page ---

/**
 * Package-internal: the Browser Tools that move the page to another URL or
 * history entry, in publication order. They take no element; each is
 * published and the Goal Loop may choose it.
 */
export const NAVIGATION_TOOLS: readonly PublishedElementTool[] = [
  navigateTool,
  navigateBackTool,
  navigateForwardTool,
  reloadTool,
];
