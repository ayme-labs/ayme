import type { Interaction } from "@ayme-dev/ayme";
import {
  lookAtPageStateForDocument,
  listRegisteredPomTargets,
  listRegisteredPoms,
  rootTargetPath,
} from "@ayme-dev/ayme/internal";

import {
  actionSignature,
  buildPageModel,
  indexMembers,
} from "../../page-model";
import { mapTargetsToRefs } from "../../shared";

/**
 * The Page Object member each Interaction acted on, by place: the member
 * whose locator or alias it names (including a Locator collection's `last()`
 * or sole element), or whose element has its captured Structural Ref in an
 * unrecorded look, while that member's
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
  let targetsByRef: ReadonlyMap<string, readonly string[]> = new Map();
  if (interactions.some(({ ref }) => ref !== undefined) && targets.length)
    try {
      const look = await lookAtPageStateForDocument(document);
      targetsByRef = mapTargetsToRefs(look.elementsByRef, targets);
    } catch {
      // Without the targets' refs, a ref locator names no member.
    }
  const members = indexMembers(
    buildPageModel(listRegisteredPoms(), new Set(), [], actionSignature),
    rootTargetPath
  );
  return interactions.map(({ locator, ref }) => {
    if (locator === undefined) return undefined;
    const paths = ref
      ? (targetsByRef.get(ref) ?? [])
      : targets
          .filter(
            (target) =>
              target.locator === locator || target.aliases?.includes(locator)
          )
          .map(({ path }) => path);
    return paths
      .map((path) => members.member(path)?.path)
      .find((path) => path !== undefined);
  });
}
