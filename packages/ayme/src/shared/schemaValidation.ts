import {
  toolInputViolations,
  violationSentences,
  type JsonSchema,
} from "@ayme-dev/core/tool-input";

import { ToolInputError } from "./errors";

/**
 * Package-internal: a Run's input once it meets its tool's input schema, as
 * the runtime checks every Run's input before the tool runs. Missing input
 * is `{}`; anything else that is not an object is refused. The tool gets a
 * copy of the input's own enumerable string-keyed properties, the ones the
 * check reads, so it never reads an inherited or symbol-keyed one nobody
 * checked.
 */
export function checkedToolInput(
  schema: JsonSchema,
  input: unknown
): Record<string, unknown> {
  const value =
    input === undefined
      ? {}
      : isRecord(input)
        ? Object.fromEntries(Object.entries(input))
        : input;
  const violations = toolInputViolations(schema, value);
  if (violations.length > 0)
    throw new ToolInputError(violationSentences(violations));
  return value as Record<string, unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
