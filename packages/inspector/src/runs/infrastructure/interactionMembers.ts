import type { Interaction } from "@ayme-dev/ayme";
import {
  listRegisteredPomTargets,
  listRegisteredPoms,
} from "@ayme-dev/ayme/internal";

import { buildPageModel, indexMembers } from "../../page-model";

/**
 * The Page Object member each Interaction acted on, by place: the member
 * whose locator it names, while that member's element is on the page. Read
 * from the registry as it is now, so a member a Run added, such as a new
 * item, is named too.
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
  const members = indexMembers(
    buildPageModel(listRegisteredPoms(), new Set(), [])
  );
  return interactions.map(({ locator }) =>
    locator === undefined
      ? undefined
      : targets
          .filter((target) => target.locator === locator)
          .map(({ path }) => members.member(path)?.path)
          .find((path) => path !== undefined)
  );
}
