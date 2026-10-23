import type { PomMemberObservation } from "../../shared";
import { sameInstance, type PomInstanceObservation } from "./pomInstance";
import type { PageObjectObservation } from "./pomTree";

/**
 * Package-internal: the name of the instance at `path` of the registered
 * Page Object `pomId`, e.g. "ListPage.items[1]"; `pomId` for the page's own.
 */
export function pomLabel(pomId: string, path: string) {
  return path ? `${pomId}.${path}` : pomId;
}

/** What the last observation of a registered Page Object found. */
export type LastObservation = {
  /** Every instance it found; undefined before the first observation. */
  instances: readonly PomInstanceObservation[] | undefined;
  memberObservations: readonly PomMemberObservation[];
  /** The paths of the collections it found holding an item with no root. */
  rootlessCollectionPaths: ReadonlySet<string>;
};

/**
 * Package-internal: whether `observation` found the same facts as `last`, so
 * a probe that found nothing new notifies nobody.
 */
export function sameObservation(
  last: LastObservation,
  { instances, memberObservations }: PageObjectObservation
): boolean {
  const previous = last.instances;
  return (
    previous?.length === instances.length &&
    previous.every((instance, index) =>
      sameInstance(instance, instances[index]!)
    ) &&
    sameMemberObservations(last.memberObservations, memberObservations)
  );
}

function sameMemberObservations(
  left: readonly PomMemberObservation[],
  right: readonly PomMemberObservation[]
) {
  return (
    left.length === right.length &&
    left.every((observation, index) => {
      const candidate = right[index];
      return (
        candidate !== undefined &&
        observation.memberName === candidate.memberName &&
        observation.kind === candidate.kind &&
        observation.count === candidate.count &&
        observation.access === candidate.access &&
        observation.error === candidate.error
      );
    })
  );
}

/**
 * Package-internal: what `observation` of the registered Page Object `pomId`
 * found wrong that `last` did not, one message each: a presence or root
 * predicate that threw, a root matching several elements, a collection
 * whose item class declares no root. A problem is reported again only when
 * it changed, or was gone and is back. A root matching none is ordinary
 * absence, never reported.
 */
export function newObservationErrors(
  pomId: string,
  last: LastObservation,
  { instances, rootlessCollections }: PageObjectObservation
): string[] {
  const errors: string[] = [];
  const previous = new Map<string, PomInstanceObservation>();
  for (const instance of last.instances ?? [])
    if (!previous.has(instance.path)) previous.set(instance.path, instance);
  for (const instance of instances) {
    const before = previous.get(instance.path);
    const label = pomLabel(pomId, instance.path);
    if (
      instance.presenceError !== undefined &&
      instance.presenceError !== before?.presenceError
    )
      errors.push(
        `The Page Object "${label}" is absent: its present predicate threw ${instance.presenceError}.`
      );
    if (
      instance.rootError !== undefined &&
      instance.rootError !== before?.rootError
    )
      errors.push(
        `The Page Object "${label}" is absent: its root predicate threw ${instance.rootError}.`
      );
    if (
      instance.rootCount !== undefined &&
      instance.rootCount >= 2 &&
      instance.rootCount !== before?.rootCount
    )
      errors.push(
        `The Page Object "${label}" is absent: its root matches ${instance.rootCount} elements.`
      );
  }
  for (const [path, className] of rootlessCollections)
    if (!last.rootlessCollectionPaths.has(path))
      errors.push(
        `The Page Object "${pomLabel(pomId, path)}" is absent: its item class ${className} declares no root.`
      );
  return errors;
}
