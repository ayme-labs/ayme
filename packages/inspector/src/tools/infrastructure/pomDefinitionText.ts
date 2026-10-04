import { getPomDefinitionText } from "@ayme-dev/ayme/internal";

/**
 * The POM definitions for `names` (every known one when none are given), as
 * `snapshot` renders them. Captures no page state.
 */
export function pomDefinitionText(...names: string[]) {
  return getPomDefinitionText(...names);
}
