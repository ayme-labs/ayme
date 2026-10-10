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
 * whose locator it names, or, for a Browser Tool's `aria-ref=…` locator,
 * the member whose element has that ref now, while that member's element is
 * on the page. Read from the registry as it is now, so a member a Run added,
 * such as a new item, is named too.
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
  const ariaRefOf = (locator: string | undefined) =>
    locator && /aria-ref=(e\d+)/.exec(locator)?.[1];
  let targetRefs: readonly (string | undefined)[] = [];
  if (interactions.some(({ locator }) => ariaRefOf(locator)) && targets.length)
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
  return interactions.map(({ locator }) => {
    if (locator === undefined) return undefined;
    const ref = ariaRefOf(locator);
    return targets
      .filter((target, index) =>
        ref ? targetRefs[index] === ref : target.locator === locator
      )
      .map(({ path }) => members.member(path)?.path)
      .find((path) => path !== undefined);
  });
}
