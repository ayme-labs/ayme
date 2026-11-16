import type { JsonSchema } from "@ayme-dev/ayme/inspector";
import {
  renderActionParameters,
  type ToolParameter,
} from "@ayme-dev/ayme/inspector";

/**
 * An action's arguments the way the definition text agents read writes
 * them, e.g. `(value: string | number, path: [string, ...number[]])` or
 * `({ email: string })`, from its input schema or from the parameters its
 * manifest records.
 */
export function actionSignature(input: JsonSchema | readonly ToolParameter[]) {
  return `(${renderActionParameters(input)})`;
}
