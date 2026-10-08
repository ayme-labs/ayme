import type { PlaywrightLocatorString } from "@ayme-dev/core/structural-observation";
import type { ActionResult } from "./actionSequence";
import type { GoalInput, Handover } from "./goalLoop";
import type { PageContextPayload } from "./pageContext";

/** A Structural Ref from the page snapshot, or a selector that matches exactly one element. */
type Target = { target: string };
type Modifier = "Alt" | "Control" | "ControlOrMeta" | "Meta" | "Shift";

/**
 * An image a tool returns, such as a screenshot. `ayme mcp` gives it to the
 * agent as an MCP image and writes it to a file named `filename`.
 */
export type ImageResult = {
  type: "image";
  /** What it shows, e.g. "the viewport", "the full page" or "element e12". */
  subject: string;
  /** A bare file name, ending in the extension of its format. */
  filename: string;
  mimeType: "image/png" | "image/jpeg";
  /** Its size in pixels. */
  width: number;
  height: number;
  /** The image's bytes, base64-encoded. */
  data: string;
};

/**
 * The input and result of each built-in tool, by name: the Browser Tools,
 * `snapshot` and `goal`. Mirrors the tools' input schemas.
 */
export type BuiltInTools = {
  click: {
    input: Target & {
      doubleClick?: boolean;
      button?: "left" | "right" | "middle";
      modifiers?: Modifier[];
    };
    result: ActionResult;
  };
  hover: { input: Target; result: ActionResult };
  type: {
    input: Target & { text: string; submit?: boolean; slowly?: boolean };
    result: ActionResult;
  };
  fill: { input: Target & { text: string }; result: ActionResult };
  check: { input: Target; result: ActionResult };
  uncheck: { input: Target; result: ActionResult };
  select_option: { input: Target & { values: string[] }; result: ActionResult };
  fill_form: {
    input: {
      fields: (Target & {
        name: string;
        type: "textbox" | "checkbox" | "radio" | "combobox" | "slider";
        value: string;
      })[];
    };
    result: ActionResult;
  };
  press_key: { input: { key: string }; result: ActionResult };
  generate_locator: {
    input: { groups: { targets: string[]; within?: string }[] };
    result: {
      /** The groups in input order, each repeating its container. */
      groups: (
        | {
            within?: string;
            /** The targets in input order, each repeating its target. */
            locators: (
              | { target: string; locator: PlaywrightLocatorString }
              | { target: string; error: string }
            )[];
          }
        | { within: string; error: string }
      )[];
    };
  };
  screenshot: {
    input: {
      type?: "png" | "jpeg";
      target?: string;
      fullPage?: boolean;
      filename?: string;
    };
    result: ImageResult;
  };
  navigate: { input: { url: string }; result: ActionResult };
  navigate_back: { input: Record<string, never>; result: ActionResult };
  navigate_forward: { input: Record<string, never>; result: ActionResult };
  reload: { input: Record<string, never>; result: ActionResult };
  snapshot: { input: { names?: string[] }; result: PageContextPayload };
  goal: { input: GoalInput; result: Handover };
};

/** A tool's input: typed for a built-in tool, any object for the others. */
export type ToolInput<N extends string> = N extends keyof BuiltInTools
  ? BuiltInTools[N]["input"]
  : object;

/** What a tool resolves with: typed for a built-in tool, `unknown` for the others. */
export type ToolResult<N extends string> = N extends keyof BuiltInTools
  ? BuiltInTools[N]["result"]
  : unknown;
