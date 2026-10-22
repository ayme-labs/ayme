import type { PomDefinitionsResult } from "../shared";
import { pomDefinitionsOf } from "./pomDefinitions";
import { listRegisteredPoms } from "./registry";

/**
 * The definitions of the classes the registered Page Objects reach: the
 * ones `names` names or, without names, all of them.
 */
export function getPomDefinitions(
  ...names: readonly string[]
): PomDefinitionsResult {
  return pomDefinitionsOf(
    listRegisteredPoms().map((registration) => registration.manifest),
    names
  );
}
