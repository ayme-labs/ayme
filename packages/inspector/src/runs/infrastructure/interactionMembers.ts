import type { Interaction } from "@ayme-dev/ayme";
import {
  getPageStateForElements,
  listRegisteredPomTargets,
  listRegisteredPoms,
} from "@ayme-dev/ayme/internal";

import {
  actionSignature,
  buildPageModel,
  indexMembers,
} from "../../page-model";

/**
 * The Page Object member each Interaction acted on, by place: the member
 * whose locator it names, or, for a Browser Tool's Interaction by Structural
 * Ref, the member whose element has that ref now, while that member's
 * element is on the page. Read from the registry as it is now, so a member a
 * Run added, such as a new item, is named too.
 */
export async function interactionMembers(
  interactions: readonly Interaction[]
): Promise<(string | undefined)[]> {
  if (interactions.every(({ locator }) => locator === undefined))
    return interactions.map(() => undefined);
  let targets: Awaited<ReturnType<typeof listRegisteredPomTargets>> = [];
  try {
    targets = await listRegisteredPomTargets();
  } catch {
    // Without the registry's targets, Interactions keep their locators.
  }
  let targetRefs: readonly (string | undefined)[] = [];
  if (interactions.some(({ ref }) => ref !== undefined) && targets.length)
    try {
      ({ refs: targetRefs } = await getPageStateForElements(
        targets.map(({ element }) => element)
      ));
    } catch {
      // Without the targets' refs, a ref locator names no member.
    }
  const members = indexMembers(
    buildPageModel(listRegisteredPoms(), new Set(), [], actionSignature)
  );
  return interactions.map(({ locator, ref }) => {
    if (locator === undefined) return undefined;
    return targets
      .filter((target, index) =>
        ref ? targetRefs[index] === ref : target.locator === locator
      )
      .map(({ path }) => members.member(path)?.path)
      .find((path) => path !== undefined);
  });
}
