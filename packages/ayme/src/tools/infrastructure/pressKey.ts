// press_key: the Browser Tool that presses a key on the focused element. It
// lives here, not beside the other Browser Tools in application, because it
// checks the key against Playwright Lite's key layout before it acts.
import { isPressableKey } from "@ayme-dev/playwright-lite/internal";
import { ToolInputError, type JsonSchema } from "../../shared";
import type { PublishedElementTool } from "../application/elementTools";

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
    // An unknown key is refused before the action starts, not by the press.
    if (!isPressableKey(key))
      throw new ToolInputError(
        `Cannot press "${key}": it is not a key name or a character.`
      );
    return context.pageStateSession.runAction(
      cursor,
      { tool: "press_key", args: input },
      () => page.keyboard.press(key)
    );
  },
};
