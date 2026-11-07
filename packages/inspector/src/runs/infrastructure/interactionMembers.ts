import type { Interaction } from "@ayme-dev/ayme/inspector";
import { rootTargetPath } from "@ayme-dev/ayme/inspector";

import {
  actionSignature,
  buildPageModel,
  indexMembers,
} from "../../page-model";
import { inspectorClient, type InspectorClient } from "../../shared";

/**
 * The Page Object member each Interaction acted on, by place: the member
 * whose locator or alias it names (including a Locator collection's `last()`
 * or sole element), or whose element has its captured Structural Ref in an
 * unrecorded look, while that member's element is on the page. Read from the
 * registry as it is now, so a member a Run added, such as a new item, is
 * named too.
 */
export async function interactionMembers(
  interactions: readonly Interaction[],
  client: InspectorClient = inspectorClient()
): Promise<(string | undefined)[]> {
  if (interactions.every(({ locator }) => locator === undefined))
    return interactions.map(() => undefined);
  let targets: Awaited<ReturnType<InspectorClient["look"]>>["targets"] = [];
  let targetsByRef: ReadonlyMap<string, readonly string[]> = new Map();
  try {
    // Without the look's targets, Interactions keep their locators.
    const look = await client.look();
    targets = look.targets;
    targetsByRef = new Map(Object.entries(look.targetsByRef));
  } catch {
    // Without the targets' refs, a ref locator names no member.
  }
  const members = indexMembers(
    buildPageModel(
      client.current().pageObjects,
      new Set(),
      [],
      actionSignature
    ),
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
