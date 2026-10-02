// The input schemas of Playwright MCP's tools at the revision the README pins:
// the MCP backend bundled in playwright-core 1.62.1
// (lib/coreBundle.js: elementSchema, clickSchema, typeSchema, selectOptionSchema,
// browser_fill_form and browser_press_key). Transcribed by hand from their zod
// definitions, keeping field names, types, enums and which fields are required;
// descriptions are left out. Playwright MCP declares no explicit defaults: an
// omitted option keeps Playwright's own (left button, no double click, fill at
// once, no submit).

type Shape = {
  type: string;
  enum?: readonly string[];
  items?: Shape;
  properties?: Record<string, Shape>;
  required?: readonly string[];
};

const element = {
  element: { type: "string" },
  target: { type: "string" },
} as const;

const modifiers: Shape = {
  type: "array",
  items: {
    type: "string",
    enum: ["Alt", "Control", "ControlOrMeta", "Meta", "Shift"],
  },
};

/** Playwright MCP's tool name for each Browser Tool with a counterpart. */
export const PLAYWRIGHT_MCP_COUNTERPARTS = {
  click: "browser_click",
  hover: "browser_hover",
  type: "browser_type",
  fill_form: "browser_fill_form",
  select_option: "browser_select_option",
  press_key: "browser_press_key",
} as const;

/** The input schema of each Playwright MCP counterpart. */
export const PLAYWRIGHT_MCP_SCHEMAS: Record<
  (typeof PLAYWRIGHT_MCP_COUNTERPARTS)[keyof typeof PLAYWRIGHT_MCP_COUNTERPARTS],
  Shape
> = {
  browser_click: {
    type: "object",
    properties: {
      ...element,
      doubleClick: { type: "boolean" },
      button: { type: "string", enum: ["left", "right", "middle"] },
      modifiers,
    },
    required: ["target"],
  },
  browser_hover: {
    type: "object",
    properties: { ...element },
    required: ["target"],
  },
  browser_type: {
    type: "object",
    properties: {
      ...element,
      text: { type: "string" },
      submit: { type: "boolean" },
      slowly: { type: "boolean" },
    },
    required: ["target", "text"],
  },
  browser_fill_form: {
    type: "object",
    properties: {
      fields: {
        type: "array",
        items: {
          type: "object",
          properties: {
            ...element,
            name: { type: "string" },
            type: {
              type: "string",
              enum: ["textbox", "checkbox", "radio", "combobox", "slider"],
            },
            value: { type: "string" },
          },
          required: ["target", "name", "type", "value"],
        },
      },
    },
    required: ["fields"],
  },
  browser_select_option: {
    type: "object",
    properties: {
      ...element,
      values: { type: "array", items: { type: "string" } },
    },
    required: ["target", "values"],
  },
  browser_press_key: {
    type: "object",
    properties: { key: { type: "string" } },
    required: ["key"],
  },
};

/** The shapes #242 sets for the Browser Tools without a counterpart. */
export const EXTRA_BROWSER_TOOL_SCHEMAS: Record<
  "dblclick" | "fill" | "check" | "uncheck",
  Shape
> = {
  dblclick: {
    type: "object",
    properties: {
      ...element,
      button: { type: "string", enum: ["left", "right", "middle"] },
      modifiers,
    },
    required: ["target"],
  },
  fill: {
    type: "object",
    properties: { ...element, text: { type: "string" } },
    required: ["target", "text"],
  },
  check: {
    type: "object",
    properties: { ...element },
    required: ["target"],
  },
  uncheck: {
    type: "object",
    properties: { ...element },
    required: ["target"],
  },
};

/** A published JSON schema reduced to what the shapes above compare. */
export function shapeOf(schema: unknown): Shape {
  const {
    type,
    enum: values,
    items,
    properties,
    required,
  } = schema as {
    type: string;
    enum?: readonly string[];
    items?: unknown;
    properties?: Record<string, unknown>;
    required?: readonly string[];
  };
  return {
    type,
    ...(values ? { enum: values } : {}),
    ...(items ? { items: shapeOf(items) } : {}),
    ...(properties
      ? {
          properties: Object.fromEntries(
            Object.entries(properties).map(([name, property]) => [
              name,
              shapeOf(property),
            ])
          ),
        }
      : {}),
    ...(required ? { required } : {}),
  };
}
