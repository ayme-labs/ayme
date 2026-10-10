import type { JsonSchema } from "@ayme-dev/ayme";
import { renderActionParameters } from "@ayme-dev/ayme/internal";

/**
 * An action's arguments the way the definition text agents read writes
 * them, e.g. `(value: string | number, path: [string, ...number[]])`.
 */
export function actionSignature(inputSchema: JsonSchema) {
  return `(${renderActionParameters(inputSchema)})`;
}
