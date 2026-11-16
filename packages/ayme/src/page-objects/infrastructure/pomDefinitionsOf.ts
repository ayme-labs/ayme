import type { PomDefinitionsResult } from "../../shared";
import { pomDefinitionsOf } from "../domain/pomDefinitions";
import type { PomRegistry } from "../application/pomRegistry";

/**
 * The definitions of the classes the Page Objects registered in `registry`
 * reach: the ones `names` names or, without names, all of them.
 */
export function getPomDefinitionsOf(
  registry: PomRegistry,
  ...names: readonly string[]
): PomDefinitionsResult {
  return pomDefinitionsOf(
    registry.listRegisteredPoms().map((registration) => registration.manifest),
    names
  );
}
