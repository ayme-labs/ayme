import type { JsonSchema } from "@ayme-dev/ayme";
import {
  inputSchemaFor,
  renderActionParameters,
  type ToolParameter,
} from "@ayme-dev/ayme/internal";

/**
 * An action's arguments the way the definition text agents read writes
 * them, e.g. `(value: string | number, path: [string, ...number[]])`, from
 * its input schema or from the parameters its manifest records.
 */
export function actionSignature(input: JsonSchema | readonly ToolParameter[]) {
  return `(${renderActionParameters(isParameters(input) ? inputSchemaFor(input) : input)})`;
}

function isParameters(
  input: JsonSchema | readonly ToolParameter[]
): input is readonly ToolParameter[] {
  return Array.isArray(input);
}
